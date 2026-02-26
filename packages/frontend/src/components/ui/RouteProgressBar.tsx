import { motion } from 'framer-motion';

export default function RouteProgressBar() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5">
      <motion.div
        className="h-full bg-primary-600"
        initial={{ width: '0%' }}
        animate={{ width: '85%' }}
        transition={{ duration: 2, ease: 'easeOut' }}
      />
    </div>
  );
}
