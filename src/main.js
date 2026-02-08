import { Storage } from './storage/storage.js';
import { registerEditorFormats } from './editor/editor.js';
import { EditorManager } from './editor/EditorManager.js';
import { NoteService } from './services/NoteService.js';
import { TagAddon } from './addons/tag.js';
import { Sidebar } from './sidebar.js';
import { ContextMenuManager } from './context-menu.js';
import { debounce } from './utils/helpers.js';
import { PALETTE_COLORS } from './utils/constants.js';

class App {
    constructor() {
        this.storage = new Storage();
        this.noteService = new NoteService(this.storage);
        this.paletteContext = null; // 'cell', 'background', 'color'
        this.folders = [];
        this.activeNoteId = null;
        this.activeFolderId = 'all';
        this.editorManager = new EditorManager(this);
        this.sidebar = null;
        this.contextMenuManager = null;
        this.tagAddon = null;
        this.hasUnsavedChanges = false; // 저장되지 않은 변경사항 여부
        this.saveStatusTimeout = null; // 저장 상태 메시지 타이머

        // 노트 링크 제안 상태
        this.linkSuggestionState = {
            active: false,
            startIndex: null, // '[[' 시작 위치
            activeIndex: 0 // 리스트 선택 인덱스
        };

        this.ui = {
            folderList: document.getElementById('folder-list'),
            sidebarFolders: document.getElementById('sidebar-folders'),
            sidebarResizer: document.getElementById('sidebar-resizer'),
            noteList: document.getElementById('notes-list'),
            slider: document.getElementById('image-size-slider'),
            tooltip: document.getElementById('image-resize-tooltip'),
            percent: document.getElementById('size-percentage'),
            titleInput: document.getElementById('note-title-input'),
            btnSetFolder: document.getElementById('btn-set-folder'),
            btnThemeToggle: document.getElementById('btn-theme-toggle'),
            btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
            btnHelp: document.getElementById('btn-help'),
            btnDailyNote: document.getElementById('btn-daily-note'),
            btnAddNote: document.getElementById('btn-add-note'),
            btnNewFolder: document.getElementById('btn-new-folder'),
            btnDeleteNote: document.getElementById('btn-delete-note'),
            searchInput: document.getElementById('search-input'),
            btnExportPdf: document.getElementById('btn-export-pdf'),
            btnRestoreNote: document.getElementById('btn-restore-note'),
            saveStatus: document.getElementById('save-status'),
            colorPicker: document.getElementById('color-picker'),
            colorPalette: document.getElementById('color-palette'),
            trashFolder: document.getElementById('trash-folder'),
            backlinksArea: document.getElementById('backlinks-area'),
            backlinksList: document.getElementById('backlinks-list'),
            helpModal: document.getElementById('help-modal'),
            btnCloseModal: document.querySelector('.btn-close-modal'),
            trashModal: document.getElementById('trash-modal'),
            trashList: document.getElementById('trash-list'),
            btnCloseTrash: document.getElementById('btn-close-trash')
        };

        // 디바운싱된 자동 저장 함수 생성
        this.debouncedAutoSave = debounce(() => this.autoSave(), 1000);

        // 팔레트 색상 정의
        this.paletteColors = PALETTE_COLORS;
    }

    // 편의를 위한 getter
    get notes() {
        return this.noteService.notes;
    }

    async init() {
        await this.storage.init();
        this.initTheme();
        await this.noteService.init(); // 노트 로드
        this.folders = await this.storage.getItems('folders') || [];
        
        const sidebarCallbacks = {
            getDataForRender: () => ({
                folders: this.folders,
                activeFolderId: this.activeFolderId,
            }),
            onFolderSelect: (id) => {
                this.activeFolderId = id;
                if (this.tagAddon) { this.tagAddon.activeTag = null; this.tagAddon.renderSidebarTags(); }
                this.sidebar.render();
                this.renderNotes();
            },
            onNoteDrop: (e, id) => this.handleNoteDrop(e, id),
            onShowFolderContextMenu: (e, id) => this.contextMenuManager.showFolderContextMenu(e, id, false),
        };
        this.sidebar = new Sidebar(this.ui, sidebarCallbacks);
        this.sidebar.init();

        const contextMenuCallbacks = {
            getDataForRender: () => ({ folders: this.folders }),
            onDeleteNote: (id) => this.deleteNote(id),
            onRestoreNote: (id) => this.restoreNote(id),
            onTogglePin: (id) => this.togglePin(id),
            onMoveNoteToFolder: (noteId, folderId) => this.moveNoteToFolder(noteId, folderId),
            onRenameFolder: (id) => this.renameFolder(id),
            onDeleteFolder: (id) => this.deleteFolder(id),
            onRestoreFolder: (id) => this.restoreFolder(id),
            onHardDeleteFolder: (id) => this.hardDeleteFolder(id),
        };
        this.contextMenuManager = new ContextMenuManager(contextMenuCallbacks);
        this.contextMenuManager.init();
        
        this.initWindowState(); // 창 크기/위치 복원

        this.injectScrollbarStyles();
        this.createNoteLinkSuggestionBox(); // 링크 제안 박스 생성
        registerEditorFormats();

        this.editorManager.init('#editor');

        this.tagAddon = new TagAddon(this);
        this.tagAddon.init();
        this.bindEvents();
        this.setupShortcuts();
        this.tagAddon.renderSidebarTags();
        this.renderNotes();
        
        // 초기 로딩 시 삭제되지 않은 메모 중 첫 번째(최신/고정) 메모를 로드
        const visibleNotes = this.notes.filter(n => !n.isDeleted);
        visibleNotes.sort((a,b) => {
            if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
            return b.updatedAt - a.updatedAt;
        });

        if (visibleNotes.length > 0) this.loadNote(visibleNotes[0].id);
        else this.createNote();
    }

    // --- 테마 초기화 및 토글 ---
    initTheme() {
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.body.classList.add('dark-mode');
            this.ui.btnThemeToggle.textContent = '☀️';
        } else {
            this.ui.btnThemeToggle.textContent = '🌙';
        }

        this.ui.btnThemeToggle.onclick = () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            this.ui.btnThemeToggle.textContent = isDark ? '☀️' : '🌙';
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        };
    }

    // --- 창 크기 및 위치 저장/복원 (Tauri 전용) ---
    async initWindowState() {
        if (!window.__TAURI__) return;
        try {
            const { appWindow } = window.__TAURI__.window;
            
            // 복원
            const savedState = localStorage.getItem('window_state');
            if (savedState) {
                const state = JSON.parse(savedState);
                if (state.width && state.height) {
                    await appWindow.setSize(new window.__TAURI__.window.PhysicalSize(state.width, state.height));
                }
                if (state.x != null && state.y != null) {
                    await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(state.x, state.y));
                }
            }

            // 변경 시 저장 (디바운싱 적용)
            const saveState = async () => {
                const size = await appWindow.innerSize();
                const pos = await appWindow.outerPosition();
                localStorage.setItem('window_state', JSON.stringify({
                    width: size.width, height: size.height, x: pos.x, y: pos.y
                }));
            };
            await appWindow.onResized(debounce(saveState, 500));
            await appWindow.onMoved(debounce(saveState, 500));
        } catch (e) {
            console.error('Window state init failed:', e);
        }
    }

    // --- 스크롤바 스타일 주입 ---
    injectScrollbarStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #editor-container {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .ql-toolbar {
                flex-shrink: 0;
            }
            #editor {
                flex: 1;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            .ql-editor {
                flex: 1;
                overflow-y: auto;
                height: 100%;
            }
            .ql-editor::-webkit-scrollbar { width: 10px; }
            .ql-editor::-webkit-scrollbar-thumb { background: #ccc; border-radius: 5px; }
            .ql-editor::-webkit-scrollbar-track { background: #f0f0f0; }

            /* Context Menu Styles */
            .context-menu {
                position: absolute;
                background: var(--bg-context-menu);
                border: 1px solid var(--color-border);
                box-shadow: 2px 2px 10px rgba(0,0,0,0.1);
                z-index: 6000;
                min-width: 160px;
                padding: 5px 0;
                border-radius: 4px;
                font-family: sans-serif;
            }
            .context-menu-item {
                padding: 8px 15px;
                cursor: pointer;
                font-size: 13px;
                color: var(--text-primary);
                display: block;
            }
            .context-menu-item:hover {
                background-color: var(--bg-context-hover);
            }
            .context-menu-separator {
                height: 1px;
                background-color: #eee;
                margin: 4px 0;
            }
            .context-menu-header {
                padding: 4px 12px;
                font-size: 11px;
                color: #999;
                font-weight: 600;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    bindEvents() {
        // 전역 드래그 앤 드롭 제어 (브라우저 기본 동작 방지)
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'none'; // 기본적으로 드롭 금지
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
        });

        this.ui.slider.addEventListener('input', (e) => {
            if (this.editorManager.selectedImage) this.editorManager.selectedImage.style.width = e.target.value + '%';
            this.ui.percent.textContent = e.target.value + '%';
        });
        this.ui.slider.addEventListener('change', () => { this.autoSave(); this.editorManager.updateTooltipPos(); });
        this.ui.btnAddNote.onclick = () => this.createNote();
        this.ui.btnDailyNote.onclick = () => this.openDailyNote();
        this.ui.btnSetFolder.onclick = () => this.storage.changeBaseDirectory();
        this.ui.btnHelp.onclick = () => this.ui.helpModal.style.display = 'flex';
        this.ui.btnNewFolder.onclick = () => this.createFolder();
        this.ui.btnDeleteNote.onclick = () => this.deleteNote();
        this.ui.searchInput.oninput = (e) => this.renderNotes(e.target.value);
        this.ui.btnRestoreNote.onclick = () => this.restoreNote();
        // 검색 필터 변경 시 재검색
        document.querySelectorAll('input[name="search-filter"]').forEach(radio => {
            radio.addEventListener('change', () => this.renderNotes(this.ui.searchInput.value));
        });
        this.ui.btnExportPdf.onclick = () => this.exportToPDF();

        // 도움말 모달 닫기 이벤트
        this.ui.btnCloseModal.onclick = () => this.ui.helpModal.style.display = 'none';
        this.ui.helpModal.onclick = (e) => {
            if (e.target === this.ui.helpModal) this.ui.helpModal.style.display = 'none';
        };
        
        // 휴지통 모달 닫기
        this.ui.btnCloseTrash.onclick = () => this.ui.trashModal.style.display = 'none';
        this.ui.trashModal.onclick = (e) => {
            if (e.target === this.ui.trashModal) this.ui.trashModal.style.display = 'none';
        };

        // --- 표 컨텍스트 메뉴 로직 ---
        const contextMenu = document.getElementById('table-context-menu');
        
        // 메뉴 항목 클릭 시 동작
        contextMenu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const tableModule = this.editorManager.quill.getModule('table');

            if (action === 'changeCellColor') {
                // 팔레트 표시
                this.paletteContext = 'cell';
                this.updatePaletteUI('background');
                this.ui.colorPalette.style.display = 'grid';
                this.ui.colorPalette.style.left = contextMenu.style.left;
                this.ui.colorPalette.style.top = contextMenu.style.top;
                contextMenu.style.display = 'none';
                e.stopPropagation(); // 문서 클릭 이벤트로 바로 닫히지 않게 방지
                return;
            }

            if (action && tableModule && tableModule[action]) {
                // 메뉴 클릭 시 에디터 포커스가 사라질 수 있으므로 위치 복구
                if (this.editorManager.lastClickedIndex !== null) {
                    this.editorManager.quill.setSelection(this.editorManager.lastClickedIndex, 0);
                }
                tableModule[action](); // 예: tableModule.insertRowAbove() 실행
                this.autoSave();
            }
            contextMenu.style.display = 'none';
        });

        // --- 팔레트 이벤트 ---
        this.ui.colorPalette.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-swatch')) {
                // 미리 지정된 색상 클릭
                const color = e.target.dataset.color;
                if (this.paletteContext === 'cell') {
                    this.applyCellColor(color);
                } else if (this.paletteContext === 'color') {
                    this.editorManager.quill.focus();
                    this.editorManager.quill.format('color', color);
                    this.autoSave();
                } else {
                    this.editorManager.quill.focus();
                    this.editorManager.quill.format('background', color);
                    this.autoSave();
                }
                this.ui.colorPalette.style.display = 'none';
            } else if (e.target.id === 'btn-custom-color') {
                // 커스텀 색상 버튼 클릭 -> 시스템 컬러 피커 열기
                this.ui.colorPicker.click();
                this.ui.colorPalette.style.display = 'none';
            }
        });

        // 시스템 컬러 피커 변경 시
        this.ui.colorPicker.addEventListener('input', (e) => {
            const color = e.target.value;
            if (this.paletteContext === 'cell') {
                this.applyCellColor(color);
            } else if (this.paletteContext === 'color') {
                this.editorManager.quill.focus();
                this.editorManager.quill.format('color', color);
                this.autoSave();
            } else {
                this.editorManager.quill.focus();
                this.editorManager.quill.format('background', color);
                this.autoSave();
            }
        });

        // 다른 곳 클릭 시 메뉴 및 팔레트 닫기
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#table-context-menu')) contextMenu.style.display = 'none';
            if (!e.target.closest('#color-palette') && !e.target.closest('.ql-highlight') && !e.target.closest('.ql-color')) {
                this.ui.colorPalette.style.display = 'none';
            }
        });

        // 창 닫기/새로고침 시 저장되지 않은 내용이 있으면 경고
        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = ''; // Chrome에서는 이 설정이 필요함
            }
        });

        // 휴지통 이벤트 연결
        this.ui.trashFolder.onclick = () => {
            this.openTrashModal();
        };
        this.ui.trashFolder.ondragover = (e) => { 
            e.preventDefault(); 
            e.stopPropagation();
            this.ui.trashFolder.classList.add('drag-over');
            e.dataTransfer.dropEffect = 'move';
        };
        this.ui.trashFolder.ondragleave = () => this.ui.trashFolder.classList.remove('drag-over');
        this.ui.trashFolder.ondrop = (e) => { 
            console.log('[Debug] 🔴 DROP on Trash Folder');
            this.ui.trashFolder.classList.remove('drag-over'); 
            this.handleNoteDrop(e, 'trash'); 
        };
    }

    // 팔레트 UI 업데이트 (배경색용/텍스트색용)
    updatePaletteUI(type) {
        const colors = this.paletteColors[type];
        const swatches = this.ui.colorPalette.querySelectorAll('.color-swatch');
        swatches.forEach((swatch, index) => {
            if (colors[index]) {
                swatch.style.backgroundColor = colors[index].color;
                swatch.dataset.color = colors[index].color;
                swatch.title = colors[index].title;
            }
        });
    }

    // 셀 배경색 적용 헬퍼 메서드
    applyCellColor(color) {
        if (this.editorManager.lastClickedIndex !== null) {
            const [leaf] = this.editorManager.quill.getLeaf(this.editorManager.lastClickedIndex);
            if (leaf) {
                const element = leaf.domNode.nodeType === 3 ? leaf.domNode.parentElement : leaf.domNode;
                const cell = element.closest('td, th');
                if (cell) {
                    cell.style.backgroundColor = color;
                    this.autoSave();
                }
            }
        }
    }

    setupShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'n') { e.preventDefault(); this.createNote(); }
            if (e.ctrlKey && e.key === 'f') { e.preventDefault(); this.ui.searchInput.focus(); }
            if (e.key === 'Delete' && document.activeElement === document.body) this.deleteNote();
            if (e.ctrlKey && e.key === 's') { 
                e.preventDefault(); 
                this.autoSave(); 
            }
        });

        // 에디터 내 키보드 이벤트 (제안 박스 네비게이션)
        this.editorManager.quill.root.addEventListener('keydown', (e) => {
            if (this.linkSuggestionState.active) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.moveSuggestionSelection(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.moveSuggestionSelection(-1);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.selectSuggestion();
                } else if (e.key === 'Escape') {
                    this.hideNoteSuggestions();
                }
            }
        });
    }

    // --- 휴지통 모달 기능 ---
    openTrashModal() {
        this.ui.trashModal.style.display = 'flex';
        this.renderTrashList();
    }

    renderTrashList() {
        this.ui.trashList.innerHTML = '';
        
        // 1. 삭제된 폴더
        const deletedFolders = this.folders.filter(f => f.isDeleted);
        deletedFolders.forEach(f => {
            const li = document.createElement('li');
            li.className = 'trash-item folder';
            li.innerHTML = `<span class="trash-icon">📁</span>${f.name}<span class="trash-info">폴더</span>`;
            
            // 클릭 시 아무 반응 없음
            li.onclick = (e) => e.stopPropagation();
            
            // 우클릭 시 메뉴 표시
            li.oncontextmenu = (e) => {
                e.preventDefault();
                this.contextMenuManager.showFolderContextMenu(e, f.id, true);
            };
            this.ui.trashList.appendChild(li);
        });

        // 2. 삭제된 메모 (삭제된 폴더에 속하지 않은 것만 표시)
        const deletedFolderIds = deletedFolders.map(f => f.id);
        const deletedNotes = this.notes.filter(n => n.isDeleted && !deletedFolderIds.includes(n.folderId));
        
        deletedNotes.sort((a, b) => b.updatedAt - a.updatedAt);
        
        deletedNotes.forEach(n => {
            const li = document.createElement('li');
            li.className = 'trash-item note';
            const dateStr = new Date(n.updatedAt).toLocaleDateString();
            li.innerHTML = `<span class="trash-icon">📝</span>${n.title}<span class="trash-info">${dateStr}</span>`;
            
            // 클릭 시 아무 반응 없음 (선택적)
            li.onclick = (e) => e.stopPropagation();

            // 우클릭 시 메뉴 표시
            li.oncontextmenu = (e) => {
                e.preventDefault();
                this.contextMenuManager.showNoteContextMenu(e, n);
            };
            this.ui.trashList.appendChild(li);
        });

        if (deletedFolders.length === 0 && deletedNotes.length === 0) {
            this.ui.trashList.innerHTML = '<li style="padding:20px; text-align:center; color:#999;">휴지통이 비어있습니다.</li>';
        }
    }

    // 메모 리스트 아이템 생성 헬퍼 (중복 제거)
    createNoteListItem(n) {
        const li = document.createElement('li');
        li.className = `note-card ${this.activeNoteId === n.id ? 'active' : ''}`;
        li.draggable = true;
        li.ondragstart = (e) => {
            console.log(`[App] Drag started for note: ${n.title} (ID: ${n.id})`);
            e.dataTransfer.setData('noteId', n.id);
            e.dataTransfer.effectAllowed = 'move'; // 이동 효과 설정
        };
        li.onclick = (e) => {
            e.stopPropagation(); // 폴더 클릭 이벤트 전파 방지
            this.loadNote(n.id);
        };
        
        // 메모 순서 변경을 위한 드롭 이벤트
        li.ondragenter = (e) => {
            e.preventDefault();
            e.stopPropagation();
            li.classList.add('drag-over-note');
        };

        li.ondragover = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move'; // 순서 변경 허용
            li.classList.add('drag-over-note');
        };

        li.ondragleave = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 자식 요소로 이동 시 클래스 제거 방지
            if (e.relatedTarget && li.contains(e.relatedTarget)) return;
            li.classList.remove('drag-over-note');
        };

        li.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            li.classList.remove('drag-over-note');
            console.log(`[Debug] 🔴 DROP on Note: "${n.title}"`);
            const sourceId = e.dataTransfer.getData('noteId');
            console.log(`[Debug] Source ID: ${sourceId}, Target ID: ${n.id}`);
            if (sourceId && sourceId !== n.id) {
                this.handleNoteReorder(sourceId, n.id);
            }
        };

        li.oncontextmenu = (e) => {
            e.preventDefault();
            this.loadNote(n.id);
            this.contextMenuManager.showNoteContextMenu(e, n);
        };
        const dateStr = new Date(n.updatedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
        const tagsStr = n.tags && n.tags.length > 0 ? n.tags.map(t => '#' + t).join(' ') : '내용 없음';
        const pinMark = n.isPinned ? '<span class="pinned-icon">📌</span> ' : '';
        li.innerHTML = `<div class="note-title">${pinMark}${n.title}</div><div class="note-info-row"><span class="note-date">${dateStr}</span><span class="note-preview">${tagsStr}</span></div>`;
        return li;
    }

    renderNotes(query = '') {
        this.ui.noteList.innerHTML = '';
        let filtered = this.notes;

        // --- 일반 뷰 처리 ---
        filtered = filtered.filter(n => !n.isDeleted);

        if (this.tagAddon && this.tagAddon.activeTag) {
            filtered = filtered.filter(n => n.tags && n.tags.includes(this.tagAddon.activeTag));
        } else if (this.activeFolderId !== 'all') {
            filtered = filtered.filter(n => n.folderId === this.activeFolderId);
        }

        if (query) {
            const q = query.toLowerCase();
            const filterType = document.querySelector('input[name="search-filter"]:checked').value;

            filtered = filtered.filter(n => {
                const matchTitle = n.title.toLowerCase().includes(q);
                const matchTag = n.tags && n.tags.some(t => t.toLowerCase().includes(q));
                const matchContent = n.content.toLowerCase().includes(q);

                if (filterType === 'tag') return matchTag;
                if (filterType === 'content') return matchContent;
                return matchTitle || matchTag || matchContent; // 전체
            });
        }

        // 정렬: 고정된 메모 우선, 그 다음 수정 시간 순
        filtered.sort((a,b) => {
            if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned; // true(1) > false(0)
            // order 값이 있으면 사용, 없으면 updatedAt 사용 (내림차순)
            const orderA = a.order !== undefined ? a.order : a.updatedAt;
            const orderB = b.order !== undefined ? b.order : b.updatedAt;
            return orderB - orderA;
        });

        filtered.forEach(n => {
            this.ui.noteList.appendChild(this.createNoteListItem(n));
        });
    }

    // 메모 순서 변경 처리
    async handleNoteReorder(sourceId, targetId) {
        // 현재 리스트에 표시된 메모들 가져오기 (필터링 로직 재사용 대신 현재 렌더링된 순서 기반으로 처리)
        // 하지만 데이터 무결성을 위해 notes 배열에서 필터링하여 찾는 것이 안전함
        
        let filtered = this.notes.filter(n => !n.isDeleted);
        if (this.tagAddon && this.tagAddon.activeTag) {
            filtered = filtered.filter(n => n.tags && n.tags.includes(this.tagAddon.activeTag));
        } else if (this.activeFolderId !== 'all') {
            filtered = filtered.filter(n => n.folderId === this.activeFolderId);
        }
        
        // 현재 정렬 상태로 정렬
        filtered.sort((a,b) => {
            if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
            const orderA = a.order !== undefined ? a.order : a.updatedAt;
            const orderB = b.order !== undefined ? b.order : b.updatedAt;
            return orderB - orderA;
        });

        const sourceIndex = filtered.findIndex(n => n.id === sourceId);
        const targetIndex = filtered.findIndex(n => n.id === targetId);

        if (sourceIndex === -1 || targetIndex === -1) return;

        // 배열 내 이동
        const [movedNote] = filtered.splice(sourceIndex, 1);
        filtered.splice(targetIndex, 0, movedNote);

        // 순서 재할당 (현재 시간 기준으로 내림차순 부여하여 정렬 유지)
        const baseOrder = Date.now();
        filtered.forEach((n, i) => {
            n.order = baseOrder - (i * 1000); // 1초 간격으로 order 부여
            this.storage.saveItem('notes', n);
        });

        this.renderNotes(this.ui.searchInput.value);
    }

    async createNote() {
        const folderId = this.activeFolderId === 'all' ? null : this.activeFolderId;
        const note = await this.noteService.createNote(folderId);
        this.loadNote(note.id);
    }

    // --- 데일리 노트 기능 ---
    async openDailyNote() {
        const today = new Date();
        const title = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        // 1. "Daily Notes" 폴더 찾기 또는 생성
        let dailyFolder = this.folders.find(f => f.name === 'Daily Notes');
        if (!dailyFolder) {
            dailyFolder = { id: Date.now().toString(), name: 'Daily Notes', isDeleted: false };
            this.folders.push(dailyFolder);
            await this.storage.saveItem('folders', dailyFolder);
            this.sidebar.render();
        }

        // 2. 오늘 날짜의 메모 찾기 (Daily Notes 폴더 내)
        let targetNote = this.noteService.notes.find(n => n.title === title && n.folderId === dailyFolder.id && !n.isDeleted);
        
        if (!targetNote) {
            // 없으면 생성
            const content = {
                ops: [
                    { insert: title },
                    { attributes: { header: 1 }, insert: '\n' },
                    { insert: '\n' }
                ]
            };

            targetNote = { 
                id: Date.now().toString(), 
                title: title, 
                content: JSON.stringify(content), 
                updatedAt: Date.now(), 
                folderId: dailyFolder.id, 
                tags: ['daily'], 
                isDeleted: false, 
                isPinned: false 
            };
            
            if (this.storage.createNoteFolder) {
                await this.storage.createNoteFolder(targetNote.id, targetNote.folderId, targetNote.title);
            }

            this.noteService.notes.unshift(targetNote);
            await this.storage.saveItem('notes', targetNote); // NoteService로 이동 가능
            
            if (this.tagAddon) {
                this.tagAddon.rebuildTagCache();
                this.tagAddon.renderSidebarTags();
            }
        }

        // 3. 해당 폴더로 이동 및 메모 열기
        this.activeFolderId = dailyFolder.id;
        this.sidebar.render();
        this.renderNotes();
        this.loadNote(targetNote.id);
    }

    async loadNote(id) {
        this.activeNoteId = id;
        this.editorManager.quill.enable(true); // 에디터 활성화
        const note = this.noteService.getNote(id);
        if (note) {
            this.editorManager.deselectImage();
            try { this.editorManager.quill.setContents(JSON.parse(note.content)); } catch(e) { this.editorManager.quill.setContents([]); }
            this.ui.titleInput.value = note.title;
            if (this.tagAddon) this.tagAddon.renderTags(note.tags || []);
            
            // 휴지통 상태에 따른 UI 변경
            if (note.isDeleted) {
                this.ui.btnRestoreNote.style.display = 'inline-block';
                this.ui.btnDeleteNote.textContent = '영구 삭제';
            } else {
                this.ui.btnRestoreNote.style.display = 'none';
                this.ui.btnDeleteNote.textContent = '삭제 (Del)';
            }
            this.renderNotes();
            this.renderBacklinks(id);
        }
    }

    async autoSave() {
        if (!this.activeNoteId) return;

        this.ui.saveStatus.textContent = '저장 중...';
        this.ui.saveStatus.style.color = '#FF9500';

        const note = this.noteService.getNote(this.activeNoteId);
        if (note) {
            const content = JSON.stringify(this.editorManager.quill.getContents());
            const plainText = this.editorManager.quill.getText();
            const title = plainText.split('\n')[0].trim() || '새 메모';
            
            this.ui.titleInput.value = note.title;
            await this.noteService.saveNote(note, content, plainText, title);

            this.renderNotes(this.ui.searchInput.value);
            if (this.tagAddon) this.tagAddon.renderSidebarTags();
            this.hasUnsavedChanges = false;
            
            this.ui.saveStatus.textContent = '✓ 저장됨';
            this.ui.saveStatus.style.color = '#34C759';
            
            if (this.saveStatusTimeout) clearTimeout(this.saveStatusTimeout);
            this.saveStatusTimeout = setTimeout(() => { this.ui.saveStatus.textContent = ''; }, 2000);
        }
    }

    // --- 백링크 렌더링 ---
    renderBacklinks(noteId) {
        // 현재 노트 ID를 링크로 포함하고 있는 다른 노트 검색
        const backlinks = this.notes.filter(n => 
            n.id !== noteId && 
            !n.isDeleted && 
            n.content.includes(`http://local-note/${noteId}"`)
        );

        if (backlinks.length > 0) {
            this.ui.backlinksArea.style.display = 'block';
            this.ui.backlinksList.innerHTML = '';
            backlinks.forEach(note => {
                const li = document.createElement('li');
                li.className = 'backlink-item';
                li.innerHTML = `<span class="backlink-icon">🔗</span>${note.title}`;
                li.onclick = () => this.loadNote(note.id);
                this.ui.backlinksList.appendChild(li);
            });
        } else {
            this.ui.backlinksArea.style.display = 'none';
        }
    }

    async handleNoteDrop(e, targetFolderId) {
        e.preventDefault();
        const noteId = e.dataTransfer.getData('noteId');
        console.log(`[Debug] handleNoteDrop: Note ${noteId} -> Folder ${targetFolderId}`);
        const note = this.noteService.getNote(noteId);
        if (note) {
            await this.noteService.moveNote(noteId, targetFolderId);
            
            if (this.tagAddon) { this.tagAddon.rebuildTagCache(); this.tagAddon.renderSidebarTags(); }
            this.renderNotes();
        }
    }

    // 확인 대화상자 헬퍼 (Tauri Native Dialog 사용)
    async confirmAction(message, type = 'warning') {
        if (window.__TAURI__) {
            return await window.__TAURI__.dialog.ask(message, { title: '확인', type });
        } else {
            return confirm(message);
        }
    }

    async deleteNote(targetId = null) {
        const id = targetId || this.activeNoteId;
        if (!id) return;
        const note = this.noteService.getNote(id);
        if (!note) return;

        if (note.isDeleted) {
            // 이미 휴지통에 있는 경우 -> 영구 삭제
            if (await this.confirmAction('이 메모를 영구적으로 삭제하시겠습니까? 복구할 수 없습니다.')) {
                await this.noteService.deleteNote(id, true);
                
                // 휴지통 모달이 열려있으면 리스트 갱신
                if (this.ui.trashModal.style.display === 'flex') {
                    this.renderTrashList();
                    if (this.activeNoteId === id) {
                        this.activeNoteId = null;
                        this.editorManager.quill.setContents([]);
                        this.ui.titleInput.value = '';
                    }
                } else {
                    this.postDeleteAction();
                }
            }
        } else {
            // 일반 메모 -> 휴지통으로 이동 (Soft Delete)
            if (await this.confirmAction('메모를 휴지통으로 이동하시겠습니까?')) {
                await this.noteService.deleteNote(id, false);
                this.postDeleteAction();
            }
        }
    }

    // 삭제/이동 후 처리 공통 로직
    postDeleteAction() {
            if (this.tagAddon) {
                this.tagAddon.rebuildTagCache(); // 삭제된 노트의 태그 반영을 위해 캐시 갱신
                this.tagAddon.renderSidebarTags();
            }
            // 현재 리스트에서 다음 메모 로드 또는 새 메모 생성
            // renderNotes를 먼저 호출하여 현재 뷰(휴지통 or 일반)에 맞는 리스트 갱신
            this.renderNotes();
            
            // 화면에 보이는 첫 번째 메모 로드
            const visibleNotes = Array.from(this.ui.noteList.children);
            if (visibleNotes.length > 0) {
                // DOM 요소에 연결된 데이터가 없으므로 notes 배열에서 다시 찾음
                // renderNotes 로직과 동일하게 필터링하여 첫 번째 요소 찾기
                let filtered = this.notes;
                if (this.activeFolderId === 'trash') filtered = filtered.filter(n => n.isDeleted);
                else filtered = filtered.filter(n => !n.isDeleted);
                
                if (this.activeFolderId !== 'all' && this.activeFolderId !== 'trash') {
                    filtered = filtered.filter(n => n.folderId === this.activeFolderId);
                }
                filtered.sort((a,b) => b.updatedAt - a.updatedAt);

                if (filtered.length > 0) this.loadNote(filtered[0].id);
                else this.createNote();
            } else {
                this.createNote();
            }
    }

    async restoreNote(targetId = null) {
        const id = targetId || this.activeNoteId;
        if (!id) return;
        const note = this.noteService.getNote(id);
        if (note && note.isDeleted) {
            if (await this.confirmAction('메모를 복구하시겠습니까?', 'info')) {
                await this.noteService.restoreNote(id);

                if (this.tagAddon) {
                    this.tagAddon.rebuildTagCache();
                    this.tagAddon.renderSidebarTags();
                }
                
                // 휴지통 모달이 열려있으면 리스트 갱신
                if (this.ui.trashModal.style.display === 'flex') {
                    this.renderTrashList();
                    this.renderNotes();
                } else {
                    // 복구 후 목록 갱신 및 첫 번째 메모 로드
                    this.renderNotes();
                    const filtered = this.notes.filter(n => n.isDeleted).sort((a,b) => b.updatedAt - a.updatedAt);
                    if (filtered.length > 0) this.loadNote(filtered[0].id);
                    else {
                        // 휴지통이 비었으면 전체 메모로 이동
                        this.activeFolderId = 'all';
                        this.sidebar.render();
                        this.renderNotes();
                        if (this.notes.length > 0) this.loadNote(this.notes[0].id);
                    }
                }
            }
        }
    }

    async restoreFolder(folderId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;

        if (await this.confirmAction(`'${folder.name}' 폴더를 복구하시겠습니까?`, 'info')) {
            // 실제 폴더를 Trash에서 복구
            if (this.storage.restoreCategoryFromTrash) {
                await this.storage.restoreCategoryFromTrash(folder.name);
            }

            folder.isDeleted = false;
            await this.storage.saveItem('folders', folder);
        this.sidebar.render();
            this.renderTrashList(); // 휴지통 리스트 갱신
        }
    }

    async hardDeleteFolder(folderId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;

        if (await this.confirmAction(`'${folder.name}' 폴더와 내부의 모든 메모를 영구적으로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
            // 1. 실제 폴더 삭제
            if (this.storage.removeCategoryFolder) {
                await this.storage.removeCategoryFolder(folder.name);
            }
            // 2. DB에서 폴더 삭제
            await this.storage.deleteItem('folders', folderId);
            this.folders = this.folders.filter(f => f.id !== folderId);
            
            // 3. 내부 메모들 DB에서 삭제
            const notesToDelete = this.notes.filter(n => n.folderId === folderId);
            for (const note of notesToDelete) {
                await this.storage.deleteItem('notes', note.id);
            }
            this.notes = this.notes.filter(n => n.folderId !== folderId);

            this.sidebar.render();
            this.renderNotes();
            this.renderTrashList(); // 휴지통 리스트 갱신
        }
    }

    // --- 노트 링크 제안 (Note Linking) ---
    createNoteLinkSuggestionBox() {
        this.ui.suggestionBox = document.createElement('div');
        this.ui.suggestionBox.className = 'suggestion-box';
        document.body.appendChild(this.ui.suggestionBox);
    }

    handleNoteLinkInput() {
        const range = this.editorManager.quill.getSelection();
        if (!range) return;

        // 커서 앞의 텍스트 확인
        const [line, offset] = this.editorManager.quill.getLine(range.index);
        const textBefore = line.domNode.textContent.slice(0, offset);
        
        // '[[' 패턴 감지 (닫는 괄호나 줄바꿈이 없는 경우)
        const match = textBefore.match(/\[\[([^\]\n]*)$/);
        
        if (match) {
            const query = match[1];
            const startIndex = range.index - query.length - 2; // '[[' 길이 포함
            this.showNoteSuggestions(query, startIndex);
        } else {
            this.hideNoteSuggestions();
        }
    }

    showNoteSuggestions(query, startIndex) {
        this.linkSuggestionState.active = true;
        this.linkSuggestionState.startIndex = startIndex;
        this.linkSuggestionState.activeIndex = 0;

        // 검색어로 노트 필터링 (현재 노트 제외)
        const filtered = this.notes.filter(n => 
            n.id !== this.activeNoteId && 
            !n.isDeleted && 
            n.title.toLowerCase().includes(query.toLowerCase())
        );

        this.ui.suggestionBox.innerHTML = '';
        if (filtered.length === 0) {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.textContent = '검색 결과 없음';
            div.style.color = '#999';
            this.ui.suggestionBox.appendChild(div);
        } else {
            filtered.forEach((note, index) => {
                const div = document.createElement('div');
                div.className = `suggestion-item ${index === 0 ? 'active' : ''}`;
                div.textContent = note.title;
                div.dataset.noteId = note.id;
                div.onmousedown = (e) => {
                    e.preventDefault();
                    this.insertNoteLink(note);
                };
                this.ui.suggestionBox.appendChild(div);
            });
        }

        // 팝업 위치 설정
        const bounds = this.editorManager.quill.getBounds(startIndex);
        const editorRect = document.getElementById('editor-container').getBoundingClientRect();
        
        this.ui.suggestionBox.style.display = 'block';
        this.ui.suggestionBox.style.left = `${editorRect.left + bounds.left}px`;
        this.ui.suggestionBox.style.top = `${editorRect.top + bounds.bottom + 5}px`;
    }

    hideNoteSuggestions() {
        this.linkSuggestionState.active = false;
        this.ui.suggestionBox.style.display = 'none';
    }

    moveSuggestionSelection(direction) {
        const items = this.ui.suggestionBox.querySelectorAll('.suggestion-item:not([style*="color: #999"])'); // 결과 없음 제외
        if (items.length === 0) return;

        items[this.linkSuggestionState.activeIndex].classList.remove('active');
        
        this.linkSuggestionState.activeIndex += direction;
        if (this.linkSuggestionState.activeIndex < 0) this.linkSuggestionState.activeIndex = items.length - 1;
        if (this.linkSuggestionState.activeIndex >= items.length) this.linkSuggestionState.activeIndex = 0;

        items[this.linkSuggestionState.activeIndex].classList.add('active');
        items[this.linkSuggestionState.activeIndex].scrollIntoView({ block: 'nearest' });
    }

    selectSuggestion() {
        const activeItem = this.ui.suggestionBox.querySelector('.suggestion-item.active');
        if (activeItem && activeItem.dataset.noteId) {
            const note = this.notes.find(n => n.id === activeItem.dataset.noteId);
            if (note) this.insertNoteLink(note);
        }
    }

    insertNoteLink(note) {
        const range = this.editorManager.quill.getSelection();
        const startIndex = this.linkSuggestionState.startIndex;
        const length = range.index - startIndex;

        // '[[검색어' 부분을 노트 제목 링크로 교체
        this.editorManager.quill.deleteText(startIndex, length);
        this.editorManager.quill.insertText(startIndex, note.title, 'link', `http://local-note/${note.id}`, 'user');
        this.editorManager.quill.insertText(startIndex + note.title.length, ' ', 'user'); // 뒤에 공백 추가
        this.editorManager.quill.setSelection(startIndex + note.title.length + 1);
        
        this.hideNoteSuggestions();
    }

    async togglePin(noteId) {
        const note = this.notes.find(n => n.id === noteId);
        if (note) {
            note.isPinned = !note.isPinned;
            await this.storage.saveItem('notes', note);
            this.renderNotes(this.ui.searchInput.value);
        }
    }

    async moveNoteToFolder(noteId, targetFolderId) {
        await this.noteService.moveNote(noteId, targetFolderId);
        if (this.tagAddon) { this.tagAddon.rebuildTagCache(); this.tagAddon.renderSidebarTags(); }
        this.postDeleteAction(); // 목록 갱신 및 다음 메모 로드
    }

    async exportToPDF() {
        if (!this.activeNoteId) return;
        
        const element = this.editorManager.quill.root; // 에디터 내용 전체
        const note = this.notes.find(n => n.id === this.activeNoteId);
        const filename = note ? `${note.title}.pdf` : 'memo.pdf';

        const opt = {
            margin:       15, // 여백 (mm)
            filename:     filename,
            image:        { type: 'jpeg', quality: 0.98 }, // 이미지 품질 설정
            html2canvas:  { scale: 2, useCORS: true, letterRendering: true }, // 고해상도 캡처
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // Tauri 환경인 경우 다이얼로그로 저장 위치 선택
        if (window.__TAURI__) {
            try {
                const savePath = await window.__TAURI__.dialog.save({
                    defaultPath: filename,
                    filters: [{ name: 'PDF', extensions: ['pdf'] }]
                });

                if (savePath) {
                    // PDF 생성 후 ArrayBuffer로 변환
                    const pdfData = await html2pdf().set(opt).from(element).outputPdf('arraybuffer');
                    // 파일 쓰기
                    await window.__TAURI__.fs.writeBinaryFile(savePath, new Uint8Array(pdfData));
                    alert('PDF가 저장되었습니다.');
                }
            } catch (e) {
                console.error('PDF 저장 실패:', e);
                alert('PDF 저장 중 오류가 발생했습니다.');
            }
        } else {
            // 웹/Electron 환경 (기존 방식)
            html2pdf().set(opt).from(element).toPdf().get('pdf').then((pdf) => {
                const totalPages = pdf.internal.getNumberOfPages();
                for (let i = 1; i <= totalPages; i++) {
                    pdf.setPage(i);
                    pdf.setFontSize(10);
                    pdf.setTextColor(150);
                    // 하단 중앙에 페이지 번호 표시 (예: 1 / 5)
                    pdf.text(`${i} / ${totalPages}`, pdf.internal.pageSize.getWidth() / 2, pdf.internal.pageSize.getHeight() - 10, { align: 'center' });
                }
            }).save();
        }
    }
}

const app = new App();
window.onload = () => app.init();
window.app = app;