// addons/tag.js
export class TagAddon {
    constructor(app) {
        this.app = app;
        this.ui = {
            container: document.getElementById('tag-area'),
            list: document.getElementById('tag-list'),
            input: document.getElementById('tag-input'),
            sidebarList: document.getElementById('tag-sidebar-list')
        };
        this.activeTag = null;
        this.tagCounts = new Map(); // 태그 캐싱을 위한 Map 추가
    }
    init() {
        this.rebuildTagCache(); // 초기 태그 캐시 생성
        this.ui.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addTag(e.target.value);
                e.target.value = '';
            }
        });
    }
    rebuildTagCache() {
        this.tagCounts.clear();
        this.app.notes.forEach(note => {
            if (note.tags && !note.isDeleted) { // 삭제되지 않은 메모만 집계
                note.tags.forEach(t => this.tagCounts.set(t, (this.tagCounts.get(t) || 0) + 1));
            }
        });
    }
    renderTags(tags = []) {
        this.ui.list.innerHTML = '';
        tags.forEach(tag => {
            const pill = document.createElement('div');
            pill.className = 'tag-pill';
            pill.innerHTML = `<span>#${tag}</span><span class="tag-remove" data-tag="${tag}">×</span>`;
            pill.querySelector('.tag-remove').onclick = () => this.removeTag(tag);
            this.ui.list.appendChild(pill);
        });
    }
    renderSidebarTags() {
        this.ui.sidebarList.innerHTML = '';
        const sortedTags = Array.from(this.tagCounts.keys()).sort(); // 캐시된 태그 사용 및 정렬
        sortedTags.forEach(tag => {
            const li = document.createElement('li');
            li.className = `folder-item ${this.activeTag === tag ? 'active' : ''}`;
            li.innerHTML = `🏷️ ${tag}`;
            li.onclick = () => {
                this.app.activeFolderId = null;
                this.activeTag = (this.activeTag === tag) ? null : tag;
                this.app.renderFolders();
                this.renderSidebarTags();
                this.app.renderNotes();
            };
            this.ui.sidebarList.appendChild(li);
        });
    }
    async addTag(tagName) {
        tagName = tagName.trim().replace(/^#/, '');
        if (!tagName || !this.app.activeNoteId) return;
        const note = this.app.notes.find(n => n.id === this.app.activeNoteId);
        if (note) {
            if (!note.tags) note.tags = [];
            if (!note.tags.includes(tagName)) {
                note.tags.push(tagName);
                this.tagCounts.set(tagName, (this.tagCounts.get(tagName) || 0) + 1); // 캐시 업데이트
                this.renderTags(note.tags);
                this.renderSidebarTags();
                await this.app.autoSave();
            }
        }
    }
    async removeTag(tagName) {
        const note = this.app.notes.find(n => n.id === this.app.activeNoteId);
        if (note && note.tags) {
            note.tags = note.tags.filter(t => t !== tagName);
            
            const count = this.tagCounts.get(tagName) || 0;
            if (count > 1) this.tagCounts.set(tagName, count - 1);
            else this.tagCounts.delete(tagName); // 카운트가 0이면 제거

            this.renderTags(note.tags);
            this.renderSidebarTags();
            await this.app.autoSave();
        }
    }
}