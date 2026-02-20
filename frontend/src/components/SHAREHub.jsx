import React from 'react';
import { X } from 'lucide-react';
import Pitchin from './Pitchin';

const SHAREHub = ({ onClose }) => {
  return (
    <div className="w-screen h-screen bg-black overflow-hidden">
      <button
        onClick={() => onClose && onClose()}
        className="fixed top-4 right-4 z-[1001] p-2 bg-black/55 hover:bg-black/80 text-white rounded-lg transition-colors"
        title="Close Pitchin"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="w-full h-full">
        <Pitchin />
      </div>
    </div>
  );
};

export default SHAREHub;
