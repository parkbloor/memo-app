export function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

export function sanitizeFileName(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_');
}
