// 기본 어댑터 (인터페이스 역할 & Web Fallback)
class BaseAdapter {
    constructor() { this.platform = 'web'; }
    async init() {}
    async getBaseDir() { return null; }
    async exists(path) { return false; }
    async mkdir(path) { }
    async readDir(path) { return []; } // Returns Array<{name, path, isDir}>
    async readFile(path) { return null; }
    async writeTextFile(path, content) {}
    async writeBinaryFile(path, buffer) {}
    async rename(oldPath, newPath) {}
    async remove(path) {}
    join(...paths) { return paths.join('/'); }
    dirname(path) { return path.substring(0, path.lastIndexOf('/')); }
    basename(path) { return path.substring(path.lastIndexOf('/') + 1); }
}

// Electron 어댑터
class ElectronAdapter extends BaseAdapter {
    constructor() {
        super();
        this.platform = 'electron';
        this.fs = window.require('fs');
        this.path = window.require('path');
        this.os = window.require('os');
    }

    async getBaseDir() {
        return this.path.join(this.os.homedir(), 'Documents', 'MemoApp');
    }

    async exists(path) { return this.fs.existsSync(path); }
    async mkdir(path) { this.fs.mkdirSync(path, { recursive: true }); }
    
    async readDir(path) {
        if (!this.fs.existsSync(path)) return [];
        const names = this.fs.readdirSync(path);
        return names.map(name => {
            const fullPath = this.path.join(path, name);
            let isDir = false;
            try { isDir = this.fs.statSync(fullPath).isDirectory(); } catch(e) {}
            return { name, path: fullPath, isDir };
        });
    }

    async readFile(path) { return this.fs.readFileSync(path, 'utf-8'); }
    async writeTextFile(path, content) { this.fs.writeFileSync(path, content); }
    async writeBinaryFile(path, buffer) { this.fs.writeFileSync(path, Buffer.from(buffer)); }
    async rename(oldPath, newPath) { this.fs.renameSync(oldPath, newPath); }
    async remove(path) { this.fs.rmSync(path, { recursive: true, force: true }); }
    
    join(...paths) { return this.path.join(...paths); }
    dirname(path) { return this.path.dirname(path); }
    basename(path) { return this.path.basename(path); }
}

// Tauri 어댑터
class TauriAdapter extends BaseAdapter {
    constructor() {
        super();
        this.platform = 'tauri';
        this.fs = window.__TAURI__.fs;
        this.path = window.__TAURI__.path;
        this.dialog = window.__TAURI__.dialog;
    }

    async getBaseDir() {
        return await this.path.join(await this.path.documentDir(), 'MemoApp');
    }

    async exists(path) { return await this.fs.exists(path); }
    async mkdir(path) { await this.fs.createDir(path, { recursive: true }); }
    
    async readDir(path) {
        try {
            const entries = await this.fs.readDir(path);
            // Tauri readDir returns { name, path, children? }
            return entries.map(entry => ({
                name: entry.name,
                path: entry.path,
                isDir: !!entry.children // children이 있으면 디렉토리로 간주 (혹은 별도 확인 필요하나 여기선 단순화)
            }));
        } catch (e) { return []; }
    }

    async readFile(path) { return await this.fs.readTextFile(path); }
    async writeTextFile(path, content) { await this.fs.writeTextFile(path, content); }
    async writeBinaryFile(path, buffer) { 
        // buffer is ArrayBuffer, convert to Uint8Array
        await this.fs.writeBinaryFile(path, new Uint8Array(buffer)); 
    }
    async rename(oldPath, newPath) { await this.fs.renameFile(oldPath, newPath); }
    async remove(path) { await this.fs.removeDir(path, { recursive: true }); }
    
    async join(...paths) { return await this.path.join(...paths); }
    async dirname(path) { return await this.path.dirname(path); }
    async basename(path) { return await this.path.basename(path); }
}

export function getFileSystemAdapter() {
    if (window.__TAURI__) {
        return new TauriAdapter();
    } else if (typeof window !== 'undefined' && window.require) {
        try {
            return new ElectronAdapter();
        } catch (e) {
            console.warn('Electron detected but require failed', e);
            return new BaseAdapter();
        }
    } else {
        return new BaseAdapter();
    }
}
