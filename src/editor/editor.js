// editor/editor.js
export function registerEditorFormats() {
    const ImageBlot = Quill.import('formats/image');

    class ResizableImage extends ImageBlot {
        static create(value) {
            const node = super.create(value);
            if (typeof value === 'object') {
                if (value.width) node.style.width = value.width;
                node.setAttribute('src', value.url);
            }
            return node;
        }
        static value(node) {
            const val = super.value(node);
            return { url: typeof val === 'string' ? val : val.url, width: node.style.width || '100%' };
        }
    }
    ResizableImage.blotName = 'image';
    ResizableImage.tagName = 'img';
    Quill.register(ResizableImage, true);

    // 접을 수 있는 섹션(Collapsible Sections) 포맷 등록
    const Parchment = Quill.import('parchment');
    const ClassAttributor = Parchment.ClassAttributor;

    // 헤더 상태: 'true'면 접힘 (화살표 회전)
    const SectionCollapsed = new ClassAttributor('section-collapsed', 'section-collapsed', { scope: Parchment.Scope.BLOCK });
    // 내용 상태: 'true'면 숨김 (display: none)
    const CollapsedContent = new ClassAttributor('collapsed-content', 'collapsed-content', { scope: Parchment.Scope.BLOCK });

    Quill.register(SectionCollapsed, true);
    Quill.register(CollapsedContent, true);
}