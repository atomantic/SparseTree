import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';

interface CopyButtonProps {
  text: string;
  label?: string;
  size?: number;
  className?: string;
}

export function CopyButton({ text, label = 'Copied!', size = 14, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(label);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={`p-1 text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors ${className}`}
      title={`Copy ${text}`}
    >
      {copied ? <Check size={size} className="text-app-success" /> : <Copy size={size} />}
    </button>
  );
}
