import { getFileSystemAdapter } from './adapters.js';
import { sanitizeFileName } from '../utils/helpers.js';

export class Storage {
    constructor() {
        this.db = null;
        this.dbName = 'MemoAppDB';
        this.version = 4;
        
        // 어댑터 초기화 (전략 패턴)
        this.adapter = getFileSystemAdapter();
        this.platform = this.adapter.platform;
        this.baseDir = null;

        console.log('[Storage] Initializing...');
        console.log(`[Storage] Platform detected: ${this.platform}`);
    }
    init() {
        return new Promise((res, rej) => {
            const req = indexedDB.open(this.dbName, this.version);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
            };
            req.onsuccess = async (e) => { 
                this.db = e.target.result; 
                await this.initFileSystem();
                await this.syncWithFileSystem(); // 파일 시스템 동기화 실행
                res(); 
            };
            req.onerror = (e) => rej(e.target.error);
        });
    }

    // 파일 시스템 초기화 (비동기)
    async initFileSystem() {
        console.log(`[Storage] initFileSystem called. Platform: ${this.platform}`);
        
        // 사용자 지정 경로 확인
        const customPath = localStorage.getItem('memo_base_dir');

        try {
            this.baseDir = customPath || await this.adapter.getBaseDir();
            console.log(`[Storage] BaseDir: ${this.baseDir}`);
            
            if (this.baseDir && !(await this.adapter.exists(this.baseDir))) {
                console.log('[Storage] Creating BaseDir...');
                await this.adapter.mkdir(this.baseDir);
            }
        } catch (e) {
            console.error('[Storage] FS init failed:', e);
        }
    }

    // 파일 시스템과 DB 동기화 (Source of Truth: File System)
    async syncWithFileSystem() {
        if (this.platform === 'web' || !this.baseDir) return;
        console.log('[Storage] Syncing with file system...');

        const fsFolders = [];
        const fsNotes = [];

        // DB 데이터 미리 로드 (충돌 해결용)
        const dbNotes = await this.getItems('notes');
        const dbNotesMap = new Map(dbNotes.map(n => [n.id, n]));

        try {
            // 1. 카테고리 폴더 스캔
            // 어댑터가 { name, path, isDir } 형태로 정규화해서 반환함
            const categories = await this.adapter.readDir(this.baseDir);

            for (const cat of categories) {
                // 시스템 파일 등 제외
                if (cat.name.startsWith('.')) continue;

                let folderId;
                let existing = null;

                // 특수 폴더 매핑
                if (cat.name === 'Uncategorized') folderId = 'all';
                else if (cat.name === 'Trash') folderId = 'trash';
                else {
                    // 일반 폴더: 기존 DB에서 이름으로 ID 찾기 또는 새 ID 부여 (하지만 여기선 동기화라 기존 ID 유지가 중요)
                    // 파일 시스템에는 ID 정보가 없으므로, 이름이 같으면 기존 ID 사용
                    const folders = await this.getItems('folders');
                    existing = folders.find(f => f.name === cat.name);
                    folderId = existing ? existing.id : Date.now().toString() + Math.random().toString().slice(2, 5);
                }

                if (folderId !== 'all' && folderId !== 'trash') {
                    const folderObj = { id: folderId, name: cat.name };
                    if (existing) {
                        folderObj.isDeleted = !!existing.isDeleted; // 기존 상태 유지
                    } else {
                        folderObj.isDeleted = false;
                    }
                    fsFolders.push(folderObj);
                }

                // 2. 노트 폴더 스캔
                // 어댑터 readDir은 디렉토리 여부를 확인해서 반환한다고 가정
                const noteDirs = await this.adapter.readDir(cat.path);

                for (const noteDir of noteDirs) {
                    let noteId, noteTitle;
                    // 1. 정규식으로 ID가 있는 폴더인지 확인 (Title_ID)
                    const match = noteDir.name.match(/^(.*)_(\d+)$/);
                    
                    if (match) {
                        noteTitle = match[1];
                        noteId = match[2];
                    } else {
                        // 2. ID가 없는 일반 폴더 발견 -> 앱 포맷으로 가져오기 (Import)
                        if (noteDir.name.startsWith('.')) continue; // 숨김 폴더 제외
                        
                        console.log(`[Storage] Importing raw folder: ${noteDir.name}`);
                        noteTitle = noteDir.name;
                        noteId = Date.now().toString(); // 새 ID 발급
                        
                        // 폴더 이름을 'Title_ID' 형식으로 변경 (정규화)
                        const newFolderName = `${sanitizeFileName(noteTitle)}_${noteId}`;
                        let newPath;
                        
                        try {
                            const dirName = await this.adapter.dirname(noteDir.path);
                            newPath = await this.adapter.join(dirName, newFolderName);
                            await this.adapter.rename(noteDir.path, newPath);
                            noteDir.path = newPath; // 경로 업데이트
                        } catch (e) {
                            console.error('[Storage] Failed to rename imported folder:', e);
                            continue;
                        }
                    }

                    let noteData = null;
                    const jsonFileName = 'data.json';
                    
                    try {
                        const jsonPath = await this.adapter.join(noteDir.path, jsonFileName);
                        if (await this.adapter.exists(jsonPath)) {
                            const content = await this.adapter.readFile(jsonPath);
                            noteData = JSON.parse(content);
                        }
                    } catch (e) {
                        console.warn(`[Storage] Failed to read data.json for note ${noteId}`, e);
                    }

                    // data.json이 없으면(외부에서 생성된 경우) 기본 데이터 생성
                    if (!noteData) {
                        let content = '{"ops":[{"insert":"\\n"}]}'; // 기본 빈 내용
                        // content.txt가 있으면 그 내용을 본문으로 사용
                        try {
                            const txtFileName = 'content.txt';
                            const txtPath = await this.adapter.join(noteDir.path, txtFileName);
                            if (await this.adapter.exists(txtPath)) {
                                const txt = await this.adapter.readFile(txtPath);
                                content = JSON.stringify({ ops: [{ insert: txt + '\n' }] });
                            }
                        } catch(e) {}

                        noteData = { id: noteId, title: noteTitle, content, updatedAt: Date.now(), folderId: null, tags: [], isDeleted: false, isPinned: false };
                    }

                    if (noteData) {
                        // 충돌 해결: DB가 더 최신이면 DB 데이터 사용 (복구)
                        const dbNote = dbNotesMap.get(noteId);
                        if (dbNote && dbNote.updatedAt > noteData.updatedAt) {
                            console.log(`[Storage] Conflict: DB is newer for ${noteId}. Restoring to FS.`);
                            noteData = { ...dbNote }; // DB 데이터 복사
                            
                            // FS에 data.json 업데이트
                            const jsonPath = await this.adapter.join(noteDir.path, jsonFileName);
                            const jsonContent = JSON.stringify(noteData, null, 2);
                            await this.adapter.writeTextFile(jsonPath, jsonContent);
                        }

                        // 폴더 위치 정보 갱신 (파일 시스템 위치가 우선)
                        noteData.folderId = folderId === 'all' ? null : folderId;
                        noteData.isDeleted = (folderId === 'trash');
                        fsNotes.push(noteData);
                    }
                }
            }

            // 3. DB 업데이트 (파일 시스템에 없는 항목 제거, 있는 항목 갱신)
            
            // 폴더 동기화
            const dbFolders = await this.getItems('folders');
            const fsFolderIds = new Set(fsFolders.map(f => f.id));
            for (const dbF of dbFolders) {
                if (!fsFolderIds.has(dbF.id)) await this.deleteItem('folders', dbF.id);
            }
            for (const fsF of fsFolders) await this.saveItem('folders', fsF);

            // 노트 동기화
            // dbNotes는 위에서 이미 가져옴
            const fsNoteIds = new Set(fsNotes.map(n => n.id));
            for (const dbN of dbNotes) {
                if (!fsNoteIds.has(dbN.id)) await this.deleteItem('notes', dbN.id);
            }
            for (const fsN of fsNotes) await this.saveItem('notes', fsN);

            console.log('[Storage] Sync complete.');
        } catch (e) {
            console.error('[Storage] Sync failed:', e);
        }
    }

    // 저장 폴더 변경 (Tauri 전용)
    async changeBaseDirectory() {
        if (this.platform !== 'tauri' || !this.adapter.dialog) {
            alert('이 기능은 현재 환경에서 지원되지 않습니다.');
            return;
        }
        
        const selected = await this.adapter.dialog.open({ directory: true, multiple: false, title: '메모를 저장할 폴더 선택' });
        if (selected) {
            localStorage.setItem('memo_base_dir', selected);
            alert(`저장 위치가 변경되었습니다.\n경로: ${selected}\n\n앱을 재시작하면 적용됩니다.`);
        }
    }

    async getItems(storeName) {
        const tx = this.db.transaction(storeName, 'readonly');
        return new Promise(res => { tx.objectStore(storeName).getAll().onsuccess = (e) => res(e.target.result); });
    }
    async saveItem(storeName, item) {
        const tx = this.db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
    }
    async deleteItem(storeName, id) {
        const tx = this.db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
    }

    // --- 파일 시스템 관련 메서드 추가 ---

    // 폴더 이름 조회 헬퍼
    async getFolderName(folderId) {
        if (folderId === 'trash') return 'Trash';
        if (!folderId || folderId === 'all') return 'Uncategorized';
        return new Promise((resolve) => {
            const tx = this.db.transaction('folders', 'readonly');
            const req = tx.objectStore('folders').get(folderId);
            req.onsuccess = () => resolve(req.result ? req.result.name : 'Uncategorized');
            req.onerror = () => resolve('Uncategorized');
        });
    }

    // 파일명으로 쓸 수 없는 문자 제거
    sanitizeFileName(name) {
        return name.replace(/[\\/:*?"<>|]/g, '_');
    }

    // 노트 ID로 실제 파일 경로 찾기 (비동기 변경)
    async findNotePath(noteId) {
        if (!this.baseDir) {
            console.warn('[Storage] findNotePath: BaseDir not ready');
            return null;
        }

        // 특정 디렉토리 안에 노트가 있는지 확인하는 헬퍼
        const checkDirForNote = async (dirPath) => {
            try {
                if (!(await this.adapter.exists(dirPath))) return null;
                const items = await this.adapter.readDir(dirPath);
                for (const item of items) {
                    if (item.name && item.name.endsWith(`_${noteId}`)) {
                        return item.path;
                    }
                }
            } catch (e) {
                return null;
            }
            return null;
        };

        try {
            const categories = await this.adapter.readDir(this.baseDir);
            for (const cat of categories) {
                // 1. 해당 카테고리 바로 아래 검색
                let found = await checkDirForNote(cat.path);
                if (found) return found;

                // 2. Trash 폴더인 경우, 그 내부의 하위 폴더(삭제된 카테고리)들도 검색
                if (cat.name === 'Trash') {
                    const trashItems = await this.adapter.readDir(cat.path);
                    for (const item of trashItems) {
                        found = await checkDirForNote(item.path);
                        if (found) return found;
                    }
                }
            }
        } catch (e) {
            console.error('[Storage] findNotePath failed:', e);
        }
        console.log(`[Storage] Note path not found for ID: ${noteId}`);
        return null;
    }

    // 카테고리 폴더 직접 생성
    async createCategoryFolder(folderName) {
        if (this.platform === 'web' || !this.baseDir) return;
        const safeName = sanitizeFileName(folderName);

        try {
            const catPath = await this.adapter.join(this.baseDir, safeName);
            if (!(await this.adapter.exists(catPath))) {
                await this.adapter.mkdir(catPath);
            }
        } catch (e) {
            console.error('[Storage] Failed to create category folder:', e);
        }
    }

    // 카테고리 폴더 이름 변경
    async renameCategoryFolder(oldName, newName) {
        if (this.platform === 'web' || !this.baseDir) return;
        
        const oldSafeName = sanitizeFileName(oldName);
        const newSafeName = sanitizeFileName(newName);

        if (oldSafeName === newSafeName) return;

        try {
            const oldPath = await this.adapter.join(this.baseDir, oldSafeName);
            const newPath = await this.adapter.join(this.baseDir, newSafeName);
            if (await this.adapter.exists(oldPath)) {
                await this.adapter.rename(oldPath, newPath);
            }
        } catch (e) {
            console.error('[Storage] Failed to rename category folder:', e);
            throw e;
        }
    }

    // 카테고리 폴더 휴지통으로 이동
    async moveCategoryToTrash(folderName) {
        if (this.platform === 'web' || !this.baseDir) return;
        const safeName = sanitizeFileName(folderName);
        
        const src = await this.adapter.join(this.baseDir, safeName);
        const destDir = await this.adapter.join(this.baseDir, 'Trash');
        const dest = await this.adapter.join(destDir, safeName);
        
        if (await this.adapter.exists(src)) {
            if (!(await this.adapter.exists(destDir))) await this.adapter.mkdir(destDir);
            await this.adapter.rename(src, dest);
        }
    }

    // 휴지통에서 카테고리 복구
    async restoreCategoryFromTrash(folderName) {
        if (this.platform === 'web' || !this.baseDir) return;
        const safeName = sanitizeFileName(folderName);
        
        const src = await this.adapter.join(this.baseDir, 'Trash', safeName);
        const dest = await this.adapter.join(this.baseDir, safeName);
        if (await this.adapter.exists(src)) await this.adapter.rename(src, dest);
    }

    // 카테고리 폴더 물리적 삭제 (재귀적)
    async removeCategoryFolder(folderName) {
        if (this.platform === 'web' || !this.baseDir) return;
        const safeName = sanitizeFileName(folderName);
        
        let catPath = await this.adapter.join(this.baseDir, safeName);
        if (!(await this.adapter.exists(catPath))) {
            catPath = await this.adapter.join(this.baseDir, 'Trash', safeName);
        }
        if (await this.adapter.exists(catPath)) await this.adapter.remove(catPath);
    }

    async createNoteFolder(noteId, folderId, title = '새 메모') {
        console.log(`[Storage] createNoteFolder: id=${noteId}, folder=${folderId}, title=${title}`);
        
        if (this.platform === 'web') {
            console.error('[Storage] createNoteFolder: FS not initialized');
            return;
        }
        const categoryName = await this.getFolderName(folderId);
        const safeCatName = sanitizeFileName(categoryName);
        
        const catPath = await this.adapter.join(this.baseDir, safeCatName);
        if (!(await this.adapter.exists(catPath))) {
            await this.adapter.mkdir(catPath);
        }

        const folderName = `${sanitizeFileName(title)}_${noteId}`;
        const notePath = await this.adapter.join(catPath, folderName);
        if (!(await this.adapter.exists(notePath))) {
            await this.adapter.mkdir(notePath);
        }
    }

    async renameNoteFolder(noteId, newTitle) {
        if (this.platform === 'web') return;
        const currentPath = await this.findNotePath(noteId);
        if (!currentPath) return;

        const newFolderName = `${sanitizeFileName(newTitle)}_${noteId}`;
        const dirName = await this.adapter.dirname(currentPath);
        const newPath = await this.adapter.join(dirName, newFolderName);
        
        if (currentPath !== newPath) {
            try { await this.adapter.rename(currentPath, newPath); } catch (e) { console.error(e); }
        }
    }

    async deleteNoteFolder(noteId) {
        if (this.platform === 'web') return;
        const notePath = await this.findNotePath(noteId);
        
        if (notePath && (await this.adapter.exists(notePath))) {
            try { await this.adapter.remove(notePath); } catch (e) { console.error(e); }
        }
    }

    async saveNoteImage(noteId, file) {
        try {
            if (this.platform === 'web') throw new Error('File System not available');
            
            const notePath = await this.findNotePath(noteId);
            if (!notePath) {
                // 노트 폴더가 없으면 기본 폴더에 생성 시도
                // DB에서 제목을 가져오거나 기본값 사용
                await this.createNoteFolder(noteId, 'all', 'Untitled');
                return this.saveNoteImage(noteId, file);
            }

            const fileName = `${Date.now()}_${sanitizeFileName(file.name)}`;
            const arrayBuffer = await file.arrayBuffer();
            const filePath = await this.adapter.join(notePath, fileName);
            
            await this.adapter.writeBinaryFile(filePath, arrayBuffer);

            if (this.platform === 'electron') {
                return `file://${filePath}`;
            } else if (this.platform === 'tauri') {
                console.log('[Storage] Image saved to:', filePath);

                // Tauri에서는 asset 프로토콜 사용 권장 (https://asset.localhost/...)
                // 여기서는 convertFileSrc를 사용한다고 가정하거나 직접 경로 반환
                // Tauri v1: window.__TAURI__.tauri.convertFileSrc(filePath)
                let imageUrl;
                // convertFileSrc 함수 찾기 (v1, v2 호환성 및 안전장치)
                const tauriModule = window.__TAURI__.tauri || window.__TAURI__.core || window.__TAURI__;
                try {
                    if (tauriModule && tauriModule.convertFileSrc) {
                        imageUrl = tauriModule.convertFileSrc(filePath);
                        console.log('[Storage] convertFileSrc result:', imageUrl);
                    }
                } catch (e) {
                    console.warn('[Storage] convertFileSrc failed:', e);
                }

                // URL 형식이 아니거나(http, asset 등), 윈도우 경로(\)가 포함되어 있으면 수동 변환
                if (!imageUrl || !/^(https?|asset):/.test(imageUrl) || imageUrl.includes('\\')) {
                    console.log('[Storage] Invalid URL detected, applying manual conversion.');
                    const assetPath = filePath.replace(/\\/g, '/');
                    // Windows(Tauri)에서는 https://asset.localhost/ 경로 사용 권장
                    // 한글, 공백, 특수문자 처리를 위해 encodeURIComponent 사용
                    imageUrl = `https://asset.localhost/${encodeURIComponent(assetPath)}`;
                }
                console.log('[Storage] Final Image URL:', imageUrl);
                return imageUrl;
            }
        } catch (e) {
            console.error('이미지 저장 실패:', e);
            alert('이미지 저장에 실패했습니다: ' + e.message);
            throw e;
        }
    }

    // 메모 내용을 텍스트 파일로 저장 (가독성 확보용)
    async saveNoteToFile(note, textContent) {
        if (this.platform === 'web') return;
        try {
            const notePath = await this.findNotePath(note.id);
            if (!notePath) return;

            // 1. 텍스트 내용 저장 (content.txt)
            const txtFileName = 'content.txt';
            const txtPath = await this.adapter.join(notePath, txtFileName);
            await this.adapter.writeTextFile(txtPath, textContent);
            
            // 2. 메타데이터 JSON 저장 (복구용) - Tauri/Electron 공통
            const jsonPath = await this.adapter.join(notePath, 'data.json');
            await this.adapter.writeTextFile(jsonPath, JSON.stringify(note, null, 2));
        } catch (e) {
            console.error('[Storage] Failed to save note text file:', e);
        }
    }

    async moveNote(noteId, targetFolderId) {
        if (this.platform === 'web') return;

        const currentPath = await this.findNotePath(noteId);
        if (!currentPath) return; // 기존 경로를 못 찾으면 중단

        const newCategoryName = await this.getFolderName(targetFolderId);
        const safeCatName = sanitizeFileName(newCategoryName);
        
        const newCatPath = await this.adapter.join(this.baseDir, safeCatName);
        if (!(await this.adapter.exists(newCatPath))) {
            await this.adapter.mkdir(newCatPath);
        }
        
        const baseName = await this.adapter.basename(currentPath);
        const newPath = await this.adapter.join(newCatPath, baseName);
        
        if (currentPath !== newPath) {
            try { await this.adapter.rename(currentPath, newPath); } catch (e) { console.error(e); }
        }
    }
}