import React from 'react';

export function SourceParsingIndicator({ sourceTitle = false }: { sourceTitle?: boolean }) {
  return <span role="status" aria-label={sourceTitle ? '正在解析来源标题' : '网页解析中'}
    data-source-title-pending={sourceTitle || undefined} className="source-parsing-indicator">
    {[0, 1, 2, 3].map(index => <span key={index} aria-hidden="true" />)}
  </span>;
}
