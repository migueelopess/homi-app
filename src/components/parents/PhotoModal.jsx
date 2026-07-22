import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Portal from '@/components/layout/Portal';

export default function PhotoModal({ url, onClose }) {
  return (
    <Portal>
    <AnimatePresence>
      {url && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative max-w-lg w-full"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={onClose}
                className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-card flex items-center justify-center shadow-lg"
              >
                <X className="w-4 h-4 text-foreground" />
              </button>
              <img
                src={url}
                alt="Foto da tarefa"
                className="w-full rounded-2xl shadow-2xl object-contain max-h-[80vh]"
              />
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </Portal>
  );
}