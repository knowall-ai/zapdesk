import { File, FileText, Image as ImageIcon } from 'lucide-react';

interface FileIconProps {
  contentType: string;
  size?: number;
}

export default function FileIcon({ contentType, size = 16 }: FileIconProps) {
  if (contentType.startsWith('image/')) return <ImageIcon size={size} />;
  if (contentType === 'application/pdf') return <FileText size={size} />;
  return <File size={size} />;
}
