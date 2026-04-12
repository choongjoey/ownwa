import type { FormEvent } from "react";
import { Icon } from "../../components/ui";

type SettingsModalProps = {
  username: string;
  value: string;
  savedValue: string;
  saving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
};

export function SettingsModal({
  username,
  value,
  savedValue,
  saving,
  onChange,
  onClose,
  onSubmit
}: SettingsModalProps) {
  const nameMissing = !savedValue;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#191d19]/28 px-4 py-6 backdrop-blur-[6px]">
      <div className="archive-card relative w-full max-w-xl rounded-[2.25rem] shadow-[0_40px_90px_rgba(18,22,18,0.26)]">
        <button className="archive-icon-button absolute right-5 top-5 z-10" onClick={onClose} type="button">
          <Icon name="close" className="h-4 w-4" />
        </button>

        <form className="px-6 pb-6 pt-7 sm:px-8 sm:pb-8" onSubmit={onSubmit}>
          <div className="pr-14">
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#61796a]">Your name</div>
            <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.05em] text-[#17211b]">How OwnWA marks your messages</h2>
            <p className="mt-4 text-sm leading-7 text-[#5d6861]">
              Set the name WhatsApp uses for you so new imports can recognize outgoing messages correctly.
            </p>
          </div>

          <div className="mt-6 rounded-[1.5rem] border border-[#dde5dd] bg-[#f6f8f4] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#61796a]">Account</div>
                <div className="mt-1 text-sm font-semibold text-[#1e2a22]">{username}</div>
              </div>
              <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#496655]">
                {nameMissing ? "Needed" : "Saved"}
              </span>
            </div>
          </div>

          <label className="mt-6 block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#68746c]">WhatsApp display name</span>
            <input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="Your WhatsApp display name"
              className="archive-input w-full"
              autoFocus
            />
          </label>

          <p className="mt-3 text-xs leading-6 text-[#738078]">Used to mark outgoing messages on new imports.</p>

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button className="archive-secondary-button w-full justify-center sm:w-auto" onClick={onClose} type="button">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="archive-primary-button w-full justify-center sm:w-auto">
              {saving ? "Saving..." : "Save name"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
