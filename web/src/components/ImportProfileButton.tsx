import { useState } from 'react';
import { Download } from 'lucide-react';

import ImportProfileDialog from './ImportProfileDialog';

export default function ImportProfileButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Import a profile from a .tar.gz file or by registry slug"
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
      >
        <Download size={16} />
        <span>Import</span>
      </button>
      <ImportProfileDialog
        open={open}
        onOpenChange={setOpen}
        onImported={() => {
          window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
        }}
      />
    </>
  );
}
