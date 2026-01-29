import { AIProviders } from 'portos-ai-toolkit/client';
import toast from 'react-hot-toast';

export function AIProvidersPage() {
  return (
    <div className="p-6">
      <AIProviders onError={toast.error} colorPrefix="app" />
    </div>
  );
}
