export class EditorManager {
    constructor(app) {
        this.app = app;
        this.quill = null;
        this.lastClickedIndex = null;
        this.highlightedTarget = null;
        this.selectedImage = null;

        // 리사이즈 상태 관리
        this.resizeState = {
            isResizing: false,
            type: null, // 'col', 'row', 'table'
            target: null,
            startX: 0,
            startY: 0,
            startWidth: 0,
            startHeight: 0
        };
    }

    init(selector) {
        const icons = Quill.import('ui/icons');
        icons['highlight'] = icons['background'];

        this.quill = new Quill(selector, {
            theme: 'snow',
            placeholder: '메모를 입력하세요...',
            modules: {
                table: true,
                toolbar: {
                    container: [
                        [{ 'header': [1, 2, false] }],
                        ['bold', 'italic', 'underline', 'color', 'highlight', 'link'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet'}, { 'list': 'check' }],
                        ['image', 'table'],
                        ['clean']
                    ],
                    handlers: {
                        'table': () => this.insertTable(),
                        'image': () => this.insertImage(),
                        'color': () => this.handleColorPicker('text'),
                        'highlight': () => this.handleColorPicker('background')
                    }
                },
                keyboard: {
                    bindings: {
                        'autoLink': {
                            key: ' ',
                            collapsed: true,
                            handler: (range, context) => this.handleAutoLink(range, context)
                        }
                    }
                }
            }
        });

        this.bindEvents();
    }

    bindEvents() {
        // 텍스트 변경 감지
        this.quill.on('text-change', () => {
            this.app.hasUnsavedChanges = true;
            this.app.handleNoteLinkInput();
            this.app.ui.saveStatus.textContent = '저장 중...';
            this.app.debouncedAutoSave();
        });

        // 에디터 클릭 이벤트 (이미지, 링크, 섹션 토글)
        this.quill.root.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG') {
                this.selectImage(e.target);
            } else if (e.target.matches('h1, h2, h3')) {
                const rect = e.target.getBoundingClientRect();
                if (e.clientX < rect.left) {
                    const blot = Quill.find(e.target);
                    if (blot) this.toggleSection(this.quill.getIndex(blot));
                    return;
                }
            } else {
                this.deselectImage();
                const link = e.target.closest('a');
                if (link && link.getAttribute('href')) {
                    const href = link.getAttribute('href');
                    if (href.startsWith('http://local-note/')) {
                        e.preventDefault();
                        this.app.loadNote(href.split('http://local-note/')[1]);
                    } else if (e.ctrlKey || e.metaKey) {
                        window.open(link.href, '_blank');
                    }
                }
            }
        });

        // 드래그 앤 드롭 (이미지)
        this.quill.root.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        });

        this.quill.root.addEventListener('drop', (e) => {
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('image/')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleImageUpload(file);
                }
            }
        });

        // 표 컨텍스트 메뉴
        this.quill.root.addEventListener('contextmenu', (e) => this.handleContextMenu(e));

        // 리사이즈 이벤트
        this.quill.root.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.quill.root.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        document.addEventListener('mousemove', (e) => this.handleResizeDrag(e));
        document.addEventListener('mouseup', () => this.handleMouseUp());
    }

    handleColorPicker(type) {
        this.app.paletteContext = type === 'text' ? 'color' : 'background';
        this.app.updatePaletteUI(type === 'text' ? 'text' : 'background');
        const className = type === 'text' ? '.ql-color' : '.ql-highlight';
        const btn = this.quill.getModule('toolbar').container.querySelector(className);
        if (btn) {
            const rect = btn.getBoundingClientRect();
            this.app.ui.colorPalette.style.display = 'grid';
            this.app.ui.colorPalette.style.left = `${rect.left}px`;
            this.app.ui.colorPalette.style.top = `${rect.bottom + 5}px`;
        }
    }

    handleAutoLink(range, context) {
        const match = context.prefix.match(/(\S+)$/);
        if (match) {
            const url = match[0];
            if (/^(https?:\/\/|www\.)[\w-\.]+\.[\w-\.]+[\S]*$/i.test(url)) {
                const index = range.index - url.length;
                const fullUrl = /^https?:\/\//i.test(url) ? url : 'http://' + url;
                this.quill.formatText(index, url.length, 'link', fullUrl, 'user');
                this.quill.insertText(range.index, ' ', 'user');
                this.quill.setSelection(range.index + 1, 0);
                this.quill.format('link', false);
                return false;
            }
        }
        return true;
    }

    insertTable() {
        const rows = prompt("행(줄) 개수를 입력하세요 (예: 3)", "3");
        const cols = prompt("열(칸) 개수를 입력하세요 (예: 3)", "3");
        if (!rows || !cols || isNaN(rows) || isNaN(cols)) return;
        this.quill.getModule('table').insertTable(parseInt(rows), parseInt(cols));
    }

    insertImage() {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/*');
        input.click();
        input.onchange = () => {
            if (input.files && input.files[0]) this.handleImageUpload(input.files[0]);
        };
    }

    async handleImageUpload(file) {
        if (!this.app.activeNoteId) return;
        if (this.app.storage.saveNoteImage) {
            try {
                const imageUrl = await this.app.storage.saveNoteImage(this.app.activeNoteId, file);
                const range = this.quill.getSelection(true) || { index: this.quill.getLength() };
                this.quill.insertEmbed(range.index, 'image', imageUrl);
            } catch (e) {
                console.error('이미지 업로드 실패:', e);
                alert('이미지 저장 중 오류가 발생했습니다.');
            }
        }
    }

    toggleSection(index) {
        const [headerLine] = this.quill.getLine(index);
        if (!headerLine) return;
        const headerFormat = headerLine.formats().header;
        if (!headerFormat) return;

        const isCollapsed = headerLine.formats()['section-collapsed'] === 'true';
        const newCollapsedState = !isCollapsed;

        this.quill.formatLine(index, headerLine.length(), 'section-collapsed', newCollapsedState ? 'true' : false);

        let currentIndex = index + headerLine.length();
        const length = this.quill.getLength();
        
        while (currentIndex < length) {
            const [line] = this.quill.getLine(currentIndex);
            if (!line) break;
            const lineFormats = line.formats();
            if (lineFormats.header && lineFormats.header <= headerFormat) break;
            this.quill.formatLine(currentIndex, line.length(), 'collapsed-content', newCollapsedState ? 'true' : false);
            currentIndex += line.length();
        }
    }

    // --- 이미지 리사이즈 관련 ---
    selectImage(img) {
        this.selectedImage = img;
        img.classList.add('selected-image');
        const w = img.style.width ? parseInt(img.style.width) : 100;
        this.app.ui.slider.value = w;
        this.app.ui.percent.textContent = w + '%';
        this.app.ui.tooltip.style.display = 'flex';
        this.updateTooltipPos();
    }

    deselectImage() {
        if (this.selectedImage) this.selectedImage.classList.remove('selected-image');
        this.selectedImage = null;
        this.app.ui.tooltip.style.display = 'none';
    }

    updateTooltipPos() {
        if (!this.selectedImage) return;
        const rect = this.selectedImage.getBoundingClientRect();
        const cont = document.getElementById('editor-container').getBoundingClientRect();
        this.app.ui.tooltip.style.top = (rect.top - cont.top) + 'px';
        this.app.ui.tooltip.style.left = (rect.left - cont.left + rect.width/2) + 'px';
    }

    // --- 표 컨텍스트 메뉴 ---
    handleContextMenu(e) {
        const tableCell = e.target.closest('td, th');
        if (tableCell) {
            e.preventDefault();
            const blot = Quill.find(tableCell);
            if (blot) {
                const index = this.quill.getIndex(blot);
                this.quill.setSelection(index, 0);
                this.lastClickedIndex = index;
            }
            const menu = document.getElementById('table-context-menu');
            menu.style.display = 'block';
            menu.style.left = `${e.pageX}px`;
            menu.style.top = `${e.pageY}px`;
        }
    }

    // --- 리사이즈 핸들러 ---
    handleMouseMove(e) {
        if (this.resizeState.isResizing) return;
        this.clearHighlight();

        const target = e.target;
        const table = target.closest('table');
        const cell = target.closest('td, th');
        this.quill.root.style.cursor = '';

        if (!table) return;
        const tableRect = table.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        const TOLERANCE = 15;

        if (Math.abs(tableRect.right - x) < TOLERANCE && Math.abs(tableRect.bottom - y) < TOLERANCE) {
            this.quill.root.style.cursor = 'nwse-resize';
            this.resizeState.type = 'table';
            this.resizeState.target = table;
            table.classList.add('resize-highlight-table');
            this.highlightedTarget = table;
            return;
        }

        if (!cell) return;
        const rect = cell.getBoundingClientRect();

        if (Math.abs(rect.right - x) < TOLERANCE) {
            this.quill.root.style.cursor = 'col-resize';
            this.resizeState.type = 'col';
            this.resizeState.target = cell;
            cell.classList.add('resize-highlight-col');
            this.highlightedTarget = cell;
            return;
        }

        if (Math.abs(rect.bottom - y) < TOLERANCE) {
            this.quill.root.style.cursor = 'row-resize';
            this.resizeState.type = 'row';
            this.resizeState.target = cell.parentElement;
            cell.classList.add('resize-highlight-row');
            this.highlightedTarget = cell;
            return;
        }
        
        this.resizeState.type = null;
        this.resizeState.target = null;
    }

    clearHighlight() {
        if (this.highlightedTarget) {
            this.highlightedTarget.classList.remove('resize-highlight-col', 'resize-highlight-row', 'resize-highlight-table');
            this.highlightedTarget = null;
        }
    }

    handleMouseDown(e) {
        if (this.resizeState.type && this.resizeState.target) {
            this.resizeState.isResizing = true;
            this.resizeState.startX = e.clientX;
            this.resizeState.startY = e.clientY;
            const rect = this.resizeState.target.getBoundingClientRect();
            this.resizeState.startWidth = rect.width;
            this.resizeState.startHeight = rect.height;
            e.preventDefault();
        }
    }

    handleResizeDrag(e) {
        if (!this.resizeState.isResizing) return;
        const dx = e.clientX - this.resizeState.startX;
        const dy = e.clientY - this.resizeState.startY;
        const target = this.resizeState.target;

        if (this.resizeState.type === 'col') {
            const newWidth = Math.max(30, this.resizeState.startWidth + dx);
            target.style.width = `px`;
            const table = target.closest('table');
            if (table) {
                const cellIndex = target.cellIndex;
                const colgroup = table.querySelector('colgroup');
                if (colgroup && colgroup.children[cellIndex]) {
                    colgroup.children[cellIndex].style.width = `px`;
                }
                if (table.rows[0] && table.rows[0].cells[cellIndex]) {
                    table.rows[0].cells[cellIndex].style.width = `px`;
                }
            }
        } else if (this.resizeState.type === 'row') {
            target.style.height = `${Math.max(30, this.resizeState.startHeight + dy)}px`;
        } else if (this.resizeState.type === 'table') {
            target.style.width = `${Math.max(100, this.resizeState.startWidth + dx)}px`;
        }
    }

    handleMouseUp() {
        if (this.resizeState.isResizing) {
            this.resizeState.isResizing = false;
            this.resizeState.type = null;
            this.resizeState.target = null;
            this.quill.root.style.cursor = '';
            this.clearHighlight();
            this.app.autoSave();
        }
    }
}
