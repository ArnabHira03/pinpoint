import { X } from "lucide-react";
import styles from "./ErrorBanner.module.css";

interface Props {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export default function ErrorBanner({ message, onRetry, onDismiss }: Props) {
  return (
    <div className={styles.banner} role="alert">
      <span className={styles.message}>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
      {onDismiss && (
        <button type="button" className="icon" aria-label="Dismiss" onClick={onDismiss}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}
