export class NoteService {
    constructor(storage) {
        this.storage = storage;
        this.notes = [];
    }

    async init() {
        this.notes = await this.storage.getItems('notes');
        return this.notes;
    }

    getNote(id) {
        return this.notes.find(n => n.id === id);
    }

    async createNote(folderId) {
        const note = { 
            id: Date.now().toString(), 
            title: '새 메모', 
            content: '{"ops":[{"insert":"\n"}]}', 
            updatedAt: Date.now(), 
            order: Date.now(), 
            folderId: folderId === 'all' ? null : folderId, 
            tags: [], 
            isDeleted: false, 
            isPinned: false 
        };
        
        if (this.storage.createNoteFolder) {
            await this.storage.createNoteFolder(note.id, note.folderId, note.title);
        }

        this.notes.unshift(note);
        await this.storage.saveItem('notes', note);
        return note;
    }

    async saveNote(note, content, plainText, title) {
        const oldTitle = note.title;
        note.content = content;
        note.updatedAt = Date.now();
        note.title = title;

        // 제목 변경 시 폴더 이름 변경
        if (oldTitle !== note.title && this.storage.renameNoteFolder) {
            await this.storage.renameNoteFolder(note.id, note.title);
        }
        
        // 텍스트 파일 저장 (선택적)
        if (this.storage.saveNoteToFile && plainText) {
            await this.storage.saveNoteToFile(note, plainText);
        }

        await this.storage.saveItem('notes', note);
    }

    async deleteNote(noteId, isHardDelete = false) {
        const index = this.notes.findIndex(n => n.id === noteId);
        if (index === -1) return;
        const note = this.notes[index];

        if (isHardDelete) {
            if (this.storage.deleteNoteFolder) {
                await this.storage.deleteNoteFolder(noteId);
            }
            await this.storage.deleteItem('notes', noteId);
            this.notes.splice(index, 1);
        } else {
            if (this.storage.moveNote) {
                await this.storage.moveNote(noteId, 'trash');
            }
            note.isDeleted = true;
            await this.storage.saveItem('notes', note);
        }
    }

    async restoreNote(noteId) {
        const note = this.getNote(noteId);
        if (note) {
            if (this.storage.moveNote) {
                await this.storage.moveNote(note.id, note.folderId || 'all');
            }
            note.isDeleted = false;
            await this.storage.saveItem('notes', note);
        }
    }

    async togglePin(noteId) {
        const note = this.getNote(noteId);
        if (note) {
            note.isPinned = !note.isPinned;
            await this.storage.saveItem('notes', note);
        }
    }

    async moveNote(noteId, targetFolderId) {
        const note = this.getNote(noteId);
        if (note) {
            if (this.storage.moveNote) {
                await this.storage.moveNote(note.id, targetFolderId);
            }
            note.folderId = targetFolderId === 'all' ? null : targetFolderId;
            
            // 휴지통에서 이동하는 경우 복구 처리
            if (note.isDeleted && targetFolderId !== 'trash') {
                note.isDeleted = false;
            } else if (targetFolderId === 'trash') {
                note.isDeleted = true;
            }
            
            await this.storage.saveItem('notes', note);
        }
    }
}
