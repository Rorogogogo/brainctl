import { useState } from 'react';
import { FilePlus2 } from 'lucide-react';

import CreateProfileDialog from './CreateProfileDialog';

export default function CreateProfileButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Create a new profile (empty or snapshot from a live agent)"
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
      >
        <FilePlus2 size={16} />
        <span>Create</span>
      </button>
      <CreateProfileDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={() => {
          window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
        }}
      />
    </>
  );
}
