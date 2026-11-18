import React from 'react';
import type { FileSource } from '../../types';
import { LocalFileIcon } from '../LocalFileIcon';

export const TextFileSource = ({ source, onClick, selected }: {
  source: FileSource; onClick: (event: React.MouseEvent) => void; selected: boolean;
}) => <div className="shrink-0 p-[5px] border-t border-ink/20" data-file-source>
  <div className="flex items-center gap-[5px] text-[15px] leading-[1.4]"><LocalFileIcon path={source.path} /><span className="min-w-0 truncate">{source.name}</span></div>
  <button type="button" title={selected ? `在文件夹中显示: ${source.path}` : '请先单击高亮卡片'} onClick={onClick} data-source-open
    className={`block max-w-full truncate mt-[5px] text-[11px] leading-[14px] font-mono text-left ${selected ? 'text-ink/80 hover:underline' : 'text-ink/40'}`}>
    ↗ {source.path}
  </button>
</div>;
