import React, { useEffect, useState } from 'react';
import { fileIcon } from '../utils/fileSource';

export const LocalFileIcon = ({ path, className = 'w-4 h-4 shrink-0' }: { path?: string; className?: string }) => {
  const [image, setImage] = useState<{ path: string; url: string }>();
  useEffect(() => {
    let active = true;
    const load = () => {
      if (path) void fileIcon(path).then(url => {
        if (active) setImage(url ? { path, url } : undefined);
      });
    };
    load();
    window.addEventListener('pywebviewready', load);
    return () => { active = false; window.removeEventListener('pywebviewready', load); };
  }, [path]);
  if (image && image.path === path) return <img className={`${className} object-contain`} src={image.url}
    alt="系统文件图标" draggable={false} onError={() => setImage(undefined)} />;
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="本地文件">
    <path d="M14 3H5v18h14V8l-5-5Z" /><path d="M14 3v5h5M8 12h8M8 16h6" />
  </svg>;
};
