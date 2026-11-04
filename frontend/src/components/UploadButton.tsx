import { Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

interface Props {
  label?: string;
  onUpload: (files: File[]) => Promise<unknown>;
}

export default function UploadButton({ label = "Add screenshots", onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    try {
      await onUpload(files);
    } catch {
      // the caller reports upload errors
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Upload size={16} aria-hidden="true" /> {busy ? "Uploading…" : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        data-testid="upload-input"
        onChange={handleChange}
      />
    </>
  );
}
