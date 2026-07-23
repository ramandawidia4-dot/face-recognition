import { useEffect } from 'react';
import { getSecuritySocket } from '@/lib/socket';
import { useSecurityStore } from '@/stores/security-store';
import { WsSecurityAlertEvent } from '@/types';

export function useSecuritySocket() {
  const { addAlertEvent, fetchUnreviewedCount } = useSecurityStore();

  useEffect(() => {
    fetchUnreviewedCount();
    const socket = getSecuritySocket();
    if (!socket) return;

    const handleSecurityAlert = (event: WsSecurityAlertEvent) => {
      addAlertEvent(event);
    };

    socket.on('security.alert', handleSecurityAlert);

    return () => {
      socket.off('security.alert', handleSecurityAlert);
    };
  }, [addAlertEvent, fetchUnreviewedCount]);

  return {
    socket: getSecuritySocket(),
  };
}
