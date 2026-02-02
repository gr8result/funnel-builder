// ============================================
// /components/email/builder/blocks/TextBlock.js
// ============================================

import RichTextEditor from "../RichTextEditor";
import TextToolbar from "../TextToolbar";

export default function TextBlock({ block, isSelected, align, boxStyle, onSelect, onUpdateContent }) {
  function exec(cmd, value = null) {
    try {
      document.execCommand(cmd, false, value);
    } catch {}
  }

  function addLink() {
    const url = prompt("Enter link URL (https://...)");
    if (!url) return;
    exec("createLink", url);
  }

  return (
    <div style={boxStyle} onMouseDown={(e) => (e.stopPropagation(), onSelect())}>
      {isSelected && <TextToolbar onCmd={(cmd) => exec(cmd)} onLink={() => addLink()} />}
      <RichTextEditor
        html={block.content?.html || ""}
        isActive={isSelected}
        align={align}
        onChangeHtml={(html) => onUpdateContent({ html })}
      />
    </div>
  );
}
