import { useEffect, useCallback, useRef } from 'react';
import { useAppStore, UserRole } from '../stores/useAppStore';

export type DataChannelMessage = 
  | { type: 'REQUEST_FULL_STATE'; senderId: string; senderRole: UserRole }
  | { type: 'SYNC_STATE'; senderId: string; senderRole: UserRole; payload: { meetingState: string | null; allowSelfUnmute: boolean } }
  | { type: 'ADMIN_MUTE_ALL'; senderId: string; senderRole: UserRole }
  | { type: 'SET_ALLOW_SELF_UNMUTE'; senderId: string; senderRole: UserRole; payload: boolean }
  | { type: 'MEETING_STATE_CHANGE'; senderId: string; senderRole: UserRole; payload: string | null };

// We use a random ID to identify this specific client instance
const CLIENT_ID = Math.random().toString(36).substring(2, 9);

export function useDataChannel(roomId: string | null) {
  const channelRef = useRef<BroadcastChannel | null>(null);

  const sendMessage = useCallback((msg: Omit<DataChannelMessage, 'senderId' | 'senderRole'>) => {
    if (!channelRef.current) return;
    const { userRole } = useAppStore.getState();
    const fullMessage: DataChannelMessage = {
      ...msg,
      senderId: CLIENT_ID,
      senderRole: userRole
    } as DataChannelMessage;
    
    channelRef.current.postMessage(fullMessage);
  }, []);

  useEffect(() => {
    if (!roomId) return;

    // Using BroadcastChannel to simulate WebRTC DataChannel for local P2P testing
    const channelName = `room-${roomId}`;
    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;

    const handleMessage = (event: MessageEvent<DataChannelMessage>) => {
      const msg = event.data;
      if (msg.senderId === CLIENT_ID) return; // Ignore our own messages

      // STALE CLOSURE PREVENTION: Always get fresh state
      const state = useAppStore.getState();
      const { userRole, roomState, setMeetingState, setAllowSelfUnmute, setIsMuted } = state;

      // ZERO TRUST AUTHORIZATION: Verify sender role for admin commands
      const isAdminCommand = ['ADMIN_MUTE_ALL', 'SET_ALLOW_SELF_UNMUTE', 'MEETING_STATE_CHANGE', 'SYNC_STATE'].includes(msg.type);
      if (isAdminCommand && msg.senderRole !== 'admin' && msg.senderRole !== 'teacher') {
        console.warn(`[DataChannel] Unauthorized ${msg.type} from role: ${msg.senderRole}`);
        return;
      }

      switch (msg.type) {
        case 'REQUEST_FULL_STATE':
          // If we are admin/teacher, we respond with the current state
          if (userRole === 'admin' || userRole === 'teacher') {
            sendMessage({
              type: 'SYNC_STATE',
              payload: {
                meetingState: roomState.meetingState,
                allowSelfUnmute: roomState.allowSelfUnmute
              }
            });
          }
          break;

        case 'SYNC_STATE':
          setMeetingState(msg.payload.meetingState);
          setAllowSelfUnmute(msg.payload.allowSelfUnmute);
          break;

        case 'ADMIN_MUTE_ALL':
          // Force mute locally
          setIsMuted(true);
          break;

        case 'SET_ALLOW_SELF_UNMUTE':
          setAllowSelfUnmute(msg.payload);
          // If self-unmute is disabled and we are a listener, force mute
          if (!msg.payload && userRole === 'listener') {
            setIsMuted(true);
          }
          break;

        case 'MEETING_STATE_CHANGE':
          setMeetingState(msg.payload);
          break;
      }
    };

    channel.onmessage = handleMessage;

    // LATE JOINER: Request full state when joining
    sendMessage({ type: 'REQUEST_FULL_STATE' });

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [roomId, sendMessage]);

  return { sendMessage };
}
