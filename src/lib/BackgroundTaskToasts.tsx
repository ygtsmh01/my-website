import { useEffect } from 'react';
import { removeTask, useBackgroundTasks } from './backgroundTasks';

const AUTO_DISMISS_MS = 8000;

function Toast({ id, label, message, status }: { id: string; label: string; message: string; status: 'done' | 'error' }) {
  useEffect(() => {
    const t = setTimeout(() => removeTask(id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [id]);

  return (
    <div className={`bg-task-toast ${status === 'error' ? 'bg-task-toast-error' : 'bg-task-toast-done'}`}>
      <span className="bg-task-toast-icon">{status === 'error' ? '✕' : '✓'}</span>
      <div className="bg-task-toast-body">
        <div className="bg-task-toast-label">{label}</div>
        <div className="bg-task-toast-message">{message}</div>
      </div>
      <button className="bg-task-toast-close" onClick={() => removeTask(id)} aria-label="Kapat">×</button>
    </div>
  );
}

export default function BackgroundTaskToasts() {
  const tasks = useBackgroundTasks();
  const finished = tasks.filter((t) => t.status === 'done' || t.status === 'error');
  if (finished.length === 0) return null;

  return (
    <div className="bg-task-toast-stack">
      {finished.map((t) => (
        <Toast key={t.id} id={t.id} label={t.label} message={t.message} status={t.status as 'done' | 'error'} />
      ))}
    </div>
  );
}
