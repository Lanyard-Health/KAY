import toast from 'react-hot-toast';
import { createElement } from 'react';
import ToastComponent from '../components/ui/Toast';

interface NotifyOptions {
  description?: string;
  duration?: number;
}

function createToast(
  variant: 'success' | 'error' | 'info' | 'loading',
  title: string,
  options?: NotifyOptions
) {
  const duration =
    options?.duration ??
    (variant === 'error' ? 6000 : variant === 'loading' ? Infinity : 4000);

  return toast.custom(
    (t) =>
      createElement(ToastComponent, {
        t,
        variant,
        title,
        description: options?.description,
      }),
    {
      duration,
      position: 'top-right',
    }
  );
}

export const notify = {
  success: (title: string, options?: NotifyOptions) =>
    createToast('success', title, options),
  error: (title: string, options?: NotifyOptions) =>
    createToast('error', title, options),
  info: (title: string, options?: NotifyOptions) =>
    createToast('info', title, options),
  loading: (title: string, options?: NotifyOptions) =>
    createToast('loading', title, options),
  dismiss: toast.dismiss,
};
