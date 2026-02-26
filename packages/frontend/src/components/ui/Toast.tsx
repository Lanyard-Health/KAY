import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import type { Toast as HotToast } from 'react-hot-toast';
import {
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

type ToastVariant = 'success' | 'error' | 'info' | 'loading';

interface ToastProps {
  t: HotToast;
  variant: ToastVariant;
  title: string;
  description?: string;
}

const VARIANT_CONFIG = {
  success: {
    border: 'border-l-green-500',
    icon: CheckCircleIcon,
    iconColor: 'text-green-500',
  },
  error: {
    border: 'border-l-red-500',
    icon: XCircleIcon,
    iconColor: 'text-red-500',
  },
  info: {
    border: 'border-l-blue-500',
    icon: InformationCircleIcon,
    iconColor: 'text-blue-500',
  },
  loading: {
    border: 'border-l-amber-500',
    icon: null,
    iconColor: '',
  },
};

export default function Toast({ t, variant, title, description }: ToastProps) {
  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: t.visible ? 1 : 0, x: t.visible ? 0 : 40, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }}
      className={clsx(
        'pointer-events-auto w-full max-w-sm rounded-xl shadow-lg bg-white border border-gray-200/60',
        'border-l-4',
        config.border,
        'flex items-start gap-3 p-4'
      )}
    >
      {variant === 'loading' ? (
        <div className="mt-0.5 h-5 w-5 flex-shrink-0">
          <div className="h-5 w-5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
        </div>
      ) : Icon ? (
        <Icon className={clsx('h-5 w-5 flex-shrink-0 mt-0.5', config.iconColor)} />
      ) : null}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {description && (
          <p className="mt-0.5 text-sm text-gray-500 line-clamp-2">{description}</p>
        )}
      </div>

      <button
        onClick={() => toast.dismiss(t.id)}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
