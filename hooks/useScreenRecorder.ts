
import { useState, useRef, useCallback } from 'react';

export const useScreenRecorder = (personaName: string) => {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      // Prompt for screen share
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true // Capture system audio if possible
      });

      // Also get mic audio to mix in? 
      // For now, screen share is the most direct way to get "video recorded conversation"
      
      const mediaRecorder = new MediaRecorder(screenStream, {
        mimeType: 'video/webm; codecs=vp9'
      });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const date = new Date().toISOString().split('T')[0];
        const filename = `${date}_${personaName.replace(/\s+/g, '_')}_Conversation.webm`;
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Stop all tracks
        screenStream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start screen recording:", err);
    }
  }, [personaName]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  return { isRecording, startRecording, stopRecording };
};
