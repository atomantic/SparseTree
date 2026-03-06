import { useState, useRef, useEffect } from 'react';
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  const handleCopy = async () => {
    if (!navigator?.clipboard?.writeText) {
      toast.error('Clipboard API not available');
      return;
    }
    const success = await navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    if (success) {
      setCopied(true);
      toast.success(label);
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Failed to copy to clipboard');
    }
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
