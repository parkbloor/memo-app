export class Sidebar {
    constructor(ui, callbacks) {
        this.ui = ui;
        this.callbacks = callbacks;
        this.state = {
            width: 220,
            isCollapsed: false,
            isResizing: false
        };
    }

    init() {
        // 저장된 상태 불러오기
        const savedWidth = localStorage.getItem('sidebar_width');
        const savedCollapsed = localStorage.getItem('sidebar_collapsed');
        
        if (savedWidth) this.state.width = parseInt(savedWidth);
        if (savedCollapsed === 'true') this.state.isCollapsed = true;

        this.applyState();
        this.bindEvents();
        this.render();
    }

    bindEvents() {
        // 토글 버튼
        this.ui.btnToggleSidebar.onclick = () => {
            this.state.isCollapsed = !this.state.isCollapsed;
            localStorage.setItem('sidebar_collapsed', this.state.isCollapsed);
            this.applyState();
        };

        // 리사이즈 이벤트
        this.ui.sidebarResizer.addEventListener('mousedown', (e) => {
            this.state.isResizing = true;
            this.ui.sidebarResizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            this.ui.sidebarFolders.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.state.isResizing) return;
            e.preventDefault();
            let newWidth = e.clientX;
            if (newWidth < 150) newWidth = 150;
            if (newWidth > 500) newWidth = 500;
            
            this.state.width = newWidth;
            this.ui.sidebarFolders.style.width = `${newWidth}px`;
        });

        document.addEventListener('mouseup', () => {
            if (this.state.isResizing) {
                this.state.isResizing = false;
                this.ui.sidebarResizer.classList.remove('resizing');
                document.body.style.cursor = '';
                this.ui.sidebarFolders.style.transition = 'width 0.3s ease';
                localStorage.setItem('sidebar_width', this.state.width);
            }
        });
    }

    applyState() {
        if (this.state.isCollapsed) {
            this.ui.sidebarFolders.classList.add('collapsed');
            this.ui.sidebarFolders.style.width = '0px';
        } else {
            this.ui.sidebarFolders.classList.remove('collapsed');
            this.ui.sidebarFolders.style.width = `${this.state.width}px`;
        }
    }

    render() {
        const { folders, activeFolderId } = this.callbacks.getDataForRender();
        this.ui.folderList.innerHTML = '';
        this.ui.folderList.appendChild(this.createFolderElement('all', '📂 모든 메모', activeFolderId));
        
        // 삭제되지 않은 폴더만 사이드바에 표시
        const activeFolders = folders.filter(f => !f.isDeleted);
        activeFolders.forEach(f => this.ui.folderList.appendChild(this.createFolderElement(f.id, `📁 ${f.name}`, activeFolderId)));
        
        // 휴지통 활성화 상태 업데이트
        if (activeFolderId === 'trash') {
            this.ui.trashFolder.classList.add('active');
        } else {
            this.ui.trashFolder.classList.remove('active');
        }
    }

    createFolderElement(id, text, activeFolderId) {
        const li = document.createElement('li');
        li.className = `folder-item ${activeFolderId === id ? 'active' : ''}`;
        li.textContent = text;
        li.onclick = () => this.callbacks.onFolderSelect(id);
        li.ondragover = (e) => { 
            e.preventDefault(); 
            e.stopPropagation();
            if (id !== 'all') {
                li.classList.add('drag-over');
                e.dataTransfer.dropEffect = 'move';
            } else {
                e.dataTransfer.dropEffect = 'none';
            }
        };
        li.ondragleave = () => li.classList.remove('drag-over');
        li.ondrop = (e) => { 
            li.classList.remove('drag-over'); 
            this.callbacks.onNoteDrop(e, id); 
        };
        
        // 사용자 폴더인 경우 우클릭 메뉴 연결
        if (id !== 'all' && id !== 'trash') {
            li.oncontextmenu = (e) => this.callbacks.onShowFolderContextMenu(e, id);
        }
        
        return li;
    }
}