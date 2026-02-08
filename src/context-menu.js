export class ContextMenuManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.noteContextMenu = null;
        this.folderContextMenu = null;
        this.targetNoteId = null;
        this.targetFolderId = null;
    }

    init() {
        this.createNoteContextMenu();
        this.createFolderContextMenu();
        
        // 외부 클릭 시 메뉴 닫기
        document.addEventListener('click', (e) => {
            if (this.noteContextMenu && !this.noteContextMenu.contains(e.target)) {
                this.noteContextMenu.style.display = 'none';
            }
            if (this.folderContextMenu && !this.folderContextMenu.contains(e.target)) {
                this.folderContextMenu.style.display = 'none';
            }
        });
    }

    createNoteContextMenu() {
        this.noteContextMenu = document.createElement('div');
        this.noteContextMenu.className = 'context-menu';
        this.noteContextMenu.style.display = 'none';
        document.body.appendChild(this.noteContextMenu);

        this.noteContextMenu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (!action) return;
            
            const noteId = this.targetNoteId;
            if (!noteId) return;

            switch (action) {
                case 'delete': this.callbacks.onDeleteNote(noteId); break;
                case 'restore': this.callbacks.onRestoreNote(noteId); break;
                case 'togglePin': this.callbacks.onTogglePin(noteId); break;
                case 'move': {
                    const folderId = e.target.dataset.folderId;
                    if (folderId) this.callbacks.onMoveNoteToFolder(noteId, folderId);
                    break;
                }
            }
            this.noteContextMenu.style.display = 'none';
        });
    }

    showNoteContextMenu(e, note) {
        const { folders } = this.callbacks.getDataForRender();
        this.targetNoteId = note.id;
        this.noteContextMenu.innerHTML = '';

        if (note.isDeleted) {
            this.noteContextMenu.innerHTML = `
                <div class="context-menu-item" data-action="restore">♻️ 복구</div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="delete" style="color:red;">🗑️ 영구 삭제</div>
            `;
        } else {
            let folderItems = '';
            folders.forEach(f => {
                if (f.id !== note.folderId && !f.isDeleted) {
                    folderItems += `<div class="context-menu-item" data-action="move" data-folder-id="${f.id}">📁 ${f.name}</div>`;
                }
            });
            
            if (note.folderId && note.folderId !== 'all') {
                 folderItems = `<div class="context-menu-item" data-action="move" data-folder-id="all">📂 분류 없음</div>` + folderItems;
            }

            const pinLabel = note.isPinned ? '🚫 고정 해제' : '📌 상단 고정';
            this.noteContextMenu.innerHTML = `
                <div class="context-menu-item" data-action="togglePin">${pinLabel}</div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="delete">🗑️ 삭제</div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-header">이동할 폴더 선택</div>
                ${folderItems || '<div class="context-menu-header" style="font-weight:normal;">이동할 폴더 없음</div>'}
            `;
        }

        this.noteContextMenu.style.left = `${e.pageX}px`;
        this.noteContextMenu.style.top = `${e.pageY}px`;
        this.noteContextMenu.style.display = 'block';
    }

    createFolderContextMenu() {
        this.folderContextMenu = document.createElement('div');
        this.folderContextMenu.className = 'context-menu';
        this.folderContextMenu.style.display = 'none';
        document.body.appendChild(this.folderContextMenu);

        this.folderContextMenu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const folderId = this.targetFolderId;
            if (!folderId) return;

            switch (action) {
                case 'rename': this.callbacks.onRenameFolder(folderId); break;
                case 'delete': this.callbacks.onDeleteFolder(folderId); break;
                case 'restore': this.callbacks.onRestoreFolder(folderId); break;
                case 'hardDelete': this.callbacks.onHardDeleteFolder(folderId); break;
            }

            this.folderContextMenu.style.display = 'none';
        });
    }

    showFolderContextMenu(e, folderId, isDeleted = false) {
        e.preventDefault();
        this.targetFolderId = folderId;

        if (isDeleted) {
            this.folderContextMenu.innerHTML = `
                <div class="context-menu-item" data-action="restore">♻️ 폴더 복구</div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="hardDelete" style="color:red;">🗑️ 영구 삭제</div>
            `;
        } else {
            this.folderContextMenu.innerHTML = `
                <div class="context-menu-item" data-action="rename">✏️ 이름 변경</div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="delete" style="color:red;">🗑️ 삭제</div>
            `;
        }
        
        this.folderContextMenu.style.left = `${e.pageX}px`;
        this.folderContextMenu.style.top = `${e.pageY}px`;
        this.folderContextMenu.style.display = 'block';
    }
}