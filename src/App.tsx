import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Users, 
  Phone, 
  Settings, 
  Plus, 
  Send, 
  ArrowLeft, 
  Video, 
  X, 
  Check, 
  LogOut,
  UserPlus,
  MoreVertical,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  ref, 
  set, 
  onValue, 
  push, 
  update, 
  remove, 
  get, 
  child,
  serverTimestamp,
  off,
  onChildAdded,
  query as rdbQuery,
  orderByChild,
  equalTo,
  limitToLast
} from 'firebase/database';

import { auth, db, firebaseConfig } from './lib/firebase';
import { rtcConfig } from './lib/webrtc';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';

// --- Types ---
interface ChatContact {
  id: string;
  name: string;
  emoji: string;
  online: boolean;
  unreadCount: number;
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: any;
}

interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromEmoji: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface CallHistory {
  id: string;
  type: 'incoming' | 'outgoing' | 'missed';
  contactName: string;
  timestamp: any;
  duration: string;
}

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignIn, setIsSignIn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [view, setView] = useState<'dashboard' | 'chat'>('dashboard');
  const [activeChat, setActiveChat] = useState<ChatContact | null>(null);
  const [activeCall, setActiveCall] = useState<any>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [notificationsCount, setNotificationsCount] = useState(0);

  // Firestore Listeners
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [callHistory, setCallHistory] = useState<CallHistory[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // WebRTC Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // --- RTDB Connection Check ---
  useEffect(() => {
    const connectedRef = ref(db, ".info/connected");
    return onValue(connectedRef, (snap) => {
      setDbConnected(snap.val() === true);
    });
  }, []);

  // --- Auth & Profile ---
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setLoginError(null);
      try {
        setUser(u);
        if (u) {
          setProfileLoading(true);
          const userRef = ref(db, `users/${u.uid}`);
          const snap = await get(userRef);
          
          if (snap.exists()) {
            setProfile(snap.val());
          } else {
            const newId = `WT-${Math.random().toString(36).substring(7).toUpperCase()}`;
            const newProfile = {
              name: u.displayName || displayName || u.email?.split('@')[0] || 'User',
              emoji: '📱',
              friendId: newId,
              online: true,
              unreadCount: 0,
              lastSeen: new Date().toISOString()
            };
            await set(userRef, newProfile);
            setProfile(newProfile);
          }
          await update(userRef, { online: true });
        } else {
          setProfile(null);
        }
      } catch (err: any) {
        console.error("Profile sync error:", err);
        setLoginError(`Profile Sync Error: ${err.message}. Please verify your Database URL and Rules.`);
      } finally {
        setProfileLoading(false);
      }
    });
  }, []);

  // Set offline on disconnect
  useEffect(() => {
    if (!user) return;
    const userRef = ref(db, `users/${user.uid}`);
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        update(userRef, { online: false });
      } else {
        update(userRef, { online: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      update(userRef, { online: false });
    };
  }, [user]);

  // --- Signaling Listener (Calls) ---
  useEffect(() => {
    if (!user) return;
    const callsRef = ref(db, 'calls');
    const q = rdbQuery(callsRef, orderByChild('receiverId'), equalTo(user.uid));
    
    const listener = onChildAdded(q, (snapshot) => {
      const callData = snapshot.val();
      if (callData.status === 'ringing') {
        setActiveCall({ id: snapshot.key, ...callData });
        setIsCalling(true);
      }
    });

    return () => off(callsRef, 'child_added', listener);
  }, [user]);

  // --- Friend Requests & Contacts Listeners ---
  useEffect(() => {
    if (!user) return;
    
    // Notifications (Friend Requests)
    const notifRef = ref(db, `users/${user.uid}/notifications`);
    const unsubNotif = onValue(notifRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setFriendRequests([]);
        setNotificationsCount(0);
        return;
      }
      const reqs = Object.entries(data).map(([id, val]: any) => ({ id: id, ...val } as FriendRequest));
      const pending = reqs.filter(r => r.status === 'pending');
      setFriendRequests(pending);
      setNotificationsCount(pending.length);
    });

    // Real Friends / Contacts Listener
    const usersRef = ref(db, 'users');
    const unsubContacts = onValue(usersRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      const allUsers = Object.entries(data)
        .map(([id, val]: any) => ({ id, ...val } as any))
        .filter(u => u.id !== user.uid) // Don't show self
        .map(u => ({
          id: u.id,
          name: u.name,
          emoji: u.emoji || '👤',
          online: u.online || false,
          unreadCount: u.unreadCount || 0
        } as ChatContact));
      setContacts(allUsers);
    });

    return () => {
      off(notifRef);
      off(usersRef);
    };
  }, [user]);

  // --- WebRTC Core Functions ---
  const startCall = async (targetId: string, type: 'audio' | 'video' = 'video') => {
    if (!user || !profile) return;
    
    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: type === 'video', 
      audio: true 
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const callsRef = ref(db, 'calls');
    const newCallRef = push(callsRef);
    await set(newCallRef, {
      callerId: user.uid,
      callerName: profile.name,
      callerEmoji: profile.emoji,
      receiverId: targetId,
      status: 'ringing',
      type,
      offer: { sdp: offer.sdp, type: offer.type },
      createdAt: serverTimestamp()
    });

    setActiveCall({ id: newCallRef.key, type, callerId: user.uid, receiverId: targetId });
    setIsCalling(true);

    // Listen for answer
    onValue(newCallRef, async (snapshot) => {
      const data = snapshot.val();
      if (data?.answer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
      if (data?.status === 'ended') {
        endCall();
      }
    });

    // Handle ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candRef = ref(db, `calls/${newCallRef.key}/candidates`);
        push(candRef, {
          ...event.candidate.toJSON(),
          type: 'caller'
        });
      }
    };

    // Listen for remote ICE candidates
    const candRef = ref(db, `calls/${newCallRef.key}/candidates`);
    onChildAdded(candRef, async (snapshot) => {
      const cand = snapshot.val();
      if (cand.type === 'receiver') {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
    });
  };

  const acceptCall = async () => {
    if (!activeCall || !user) return;

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: activeCall.type === 'video', 
      audio: true 
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
    };

    // Set Remote SDP (Offer)
    await pc.setRemoteDescription(new RTCSessionDescription(activeCall.offer));

    // Create Answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const callRef = ref(db, `calls/${activeCall.id}`);
    await update(callRef, {
      answer: { sdp: answer.sdp, type: answer.type },
      status: 'active'
    });

    // Handle ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candRef = ref(db, `calls/${activeCall.id}/candidates`);
        push(candRef, {
          ...event.candidate.toJSON(),
          type: 'receiver'
        });
      }
    };

    // Listen for caller ICE candidates
    const candRef = ref(db, `calls/${activeCall.id}/candidates`);
    onChildAdded(candRef, async (snapshot) => {
      const cand = snapshot.val();
      if (cand.type === 'caller') {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
    });

    // Listen for call end
    onValue(callRef, (snapshot) => {
      if (snapshot.val()?.status === 'ended') endCall();
    });
  };

  const endCall = async () => {
    if (activeCall?.id) {
      const callRef = ref(db, `calls/${activeCall.id}`);
      await update(callRef, { status: 'ended' });
    }
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    setIsCalling(false);
    setActiveCall(null);
  };

  // --- Messaging Listener ---
  useEffect(() => {
    if (!user || !activeChat) {
      setMessages([]);
      return;
    }

    const chatId = [user.uid, activeChat.id].sort().join('_');
    const msgRef = ref(db, `chats/${chatId}/messages`);
    const q = rdbQuery(msgRef, limitToLast(50));

    const unsub = onValue(q, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setMessages([]);
        return;
      }
      const msgs = Object.entries(data).map(([id, val]: any) => ({ id: id, ...val } as Message));
      setMessages(msgs.sort((a, b) => a.timestamp - b.timestamp));
    });

    // Clear unread count when opening chat
    const userRef = ref(db, `users/${user.uid}`);
    update(userRef, { unreadCount: 0 });

    return () => off(q);
  }, [user, activeChat]);

  // --- Messaging Logic ---
  const sendMessage = async (text: string) => {
    if (!user || !activeChat || !text.trim()) return;
    const chatId = [user.uid, activeChat.id].sort().join('_');
    const msgRef = ref(db, `chats/${chatId}/messages`);
    
    await push(msgRef, {
      senderId: user.uid,
      text,
      timestamp: serverTimestamp()
    });

    // Increment unread count for partner
    const partnerRef = ref(db, `users/${activeChat.id}`);
    update(partnerRef, { unreadCount: (activeChat.unreadCount || 0) + 1 });
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (!isSignIn && !displayName.trim()) {
      setLoginError("Please enter your name.");
      return;
    }
    setLoading(true);
    setLoginError(null);
    try {
      if (isSignIn) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        // Initial profile update for new email users
        await updateProfile(userCred.user, {
          displayName: displayName.trim()
        });
      }
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/operation-not-allowed') {
        setLoginError('Email/Password provider is disabled. Enable it in Firebase Console > Authentication > Sign-in method.');
      } else if (error.code === 'auth/weak-password') {
        setLoginError('Password should be at least 6 characters.');
      } else if (error.code === 'auth/email-already-in-use') {
        setLoginError('This email is already in use.');
      } else if (error.code === 'auth/invalid-credential') {
        setLoginError('Invalid email or password.');
      } else {
        setLoginError(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // --- Handlers ---
  const handleLogin = async () => {
    try {
      setLoginError(null);
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/operation-not-allowed') {
        setLoginError('Google Login is not enabled in your Firebase Console.');
      } else if (error.code === 'auth/popup-blocked') {
        setLoginError('Popup was blocked by your browser.');
      } else {
        setLoginError(error.message);
      }
    }
  };
  const handleLogout = () => signOut(auth);

  const sendFriendRequest = async (targetFriendId: string) => {
    if (!user || !profile || !targetFriendId.trim()) return;
    try {
      const usersRef = ref(db, 'users');
      const q = rdbQuery(usersRef, orderByChild('friendId'), equalTo(targetFriendId.trim().toUpperCase()));
      const snap = await get(q);
      
      if (snap.exists()) {
        const targetUid = Object.keys(snap.val())[0];
        const notifRef = ref(db, `users/${targetUid}/notifications`);
        await push(notifRef, {
          fromId: user.uid,
          fromName: profile.name,
          fromEmoji: profile.emoji,
          status: 'pending',
          timestamp: serverTimestamp()
        });
        alert(`Request sent to ${snap.val()[targetUid].name}!`);
      } else {
        alert("User ID not found. Tip: Ask your friend for their WT-XXXX ID.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const acceptFriendRequest = async (requestId: string) => {
    if (!user) return;
    const reqRef = ref(db, `users/${user.uid}/notifications/${requestId}`);
    await update(reqRef, { status: 'accepted' });
  };

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F5F5F7]">
        <div className="flex flex-col items-center gap-4">
          <motion.div 
            animate={{ rotate: 360 }} 
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full"
          />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Establishing Secure Link...</p>
          
          <div className="mt-8">
            <Button 
               variant="ghost" 
               className="text-[10px] font-bold text-slate-300 hover:text-red-500 uppercase tracking-[0.2em]"
               onClick={() => {
                 signOut(auth);
                 window.location.reload();
               }}
            >
              Reset Session
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F5F5F7] p-6 font-sans">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center bg-white p-10 rounded-[32px] shadow-2xl border border-slate-100 max-w-sm w-full"
        >
          <div className="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center mb-8 mx-auto shadow-xl shadow-blue-500/20">
            <Activity className="text-white w-12 h-12" />
          </div>
          <h1 className="text-4xl font-black text-slate-900 mb-2 tracking-tight">Wifitel</h1>
          <p className="text-slate-500 mb-8 text-sm font-medium leading-relaxed uppercase tracking-wider">Secure Video Calling</p>
          
          {dbConnected === false && (
             <div className="bg-red-50 border border-red-200 text-red-700 text-[10px] py-3 px-4 rounded-xl mb-6 font-bold flex flex-col gap-1 items-start text-left">
                <span className="flex items-center gap-1">🚫 <span className="uppercase tracking-widest">Database Offline</span></span>
                <p className="font-medium normal-case leading-relaxed">Could not connect to Firebase Realtime Database. Please check your <b>databaseURL</b> in the configuration.</p>
             </div>
          )}

          {firebaseConfig.appId.length < 20 && (
             <div className="bg-amber-50 border border-amber-200 text-amber-700 text-[10px] py-3 px-4 rounded-xl mb-6 font-bold flex flex-col gap-1 items-start text-left">
                <span className="flex items-center gap-1">⚠️ <span className="uppercase tracking-widest">Configuration Warning</span></span>
                <p className="font-medium normal-case leading-relaxed">Your <b>appId</b> looks too short or incomplete. Please check your Firebase settings.</p>
             </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
            <div className="space-y-2">
              {!isSignIn && (
                <Input 
                  type="text" 
                  placeholder="Full Name" 
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all px-4 font-medium"
                  required
                />
              )}
              <Input 
                type="email" 
                placeholder="Email Address" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all px-4 font-medium"
                required
              />
              <Input 
                type="password" 
                placeholder="Password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all px-4 font-medium"
                required
              />
            </div>
            
            <Button 
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-sm font-bold rounded-xl shadow-md shadow-blue-500/20 transition-all active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Processing...
                </span>
              ) : (
                isSignIn ? 'Sign In with Email' : 'Create Account'
              )}
            </Button>
            
            <button 
              type="button"
              onClick={() => setIsSignIn(!isSignIn)}
              className="text-xs font-bold text-slate-400 hover:text-blue-600 uppercase tracking-widest transition-colors"
            >
              {isSignIn ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </form>

          <div className="flex items-center gap-4 mb-6">
            <div className="h-px bg-slate-100 flex-1"></div>
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">OR</span>
            <div className="h-px bg-slate-100 flex-1"></div>
          </div>

          <Button 
            onClick={handleLogin} 
            variant="outline"
            className="w-full border-slate-200 hover:bg-slate-50 h-12 text-sm font-bold rounded-xl transition-all shadow-sm mb-4 flex items-center justify-center gap-3"
          >
            <div className="w-5 h-5 flex items-center justify-center">
               <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            </div>
            Sign in with Google
          </Button>

          {loginError && (
             <div className="bg-red-50 border border-red-100 text-red-600 text-[11px] py-3 px-4 rounded-xl mb-6 font-bold flex items-center gap-2">
                <span className="text-sm">⚠️</span> {loginError}
             </div>
          )}

          <div className="pt-6 border-t border-slate-100 mt-4 text-left">
             <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 text-center italic">Action Required</h3>
             <ul className="space-y-4">
                <li className="flex gap-3 text-xs text-slate-600 font-medium leading-normal bg-slate-50 p-3 rounded-xl border border-slate-100">
                   <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] shrink-0">1</span>
                   <span><b>Enable Providers:</b> In Firebase Console &gt; Auth &gt; Sign-in method, enable <b>Email/Password</b> and <b>Google</b>.</span>
                </li>
                <li className="flex gap-3 text-xs text-slate-600 font-medium leading-normal bg-slate-50 p-3 rounded-xl border border-slate-100">
                   <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] shrink-0">2</span>
                   <span><b>Add Authorized Domain:</b> In Authentication &gt; Settings, add <code>{window.location.hostname}</code></span>
                </li>
                <li className="flex gap-3 text-xs text-slate-600 font-medium leading-normal bg-slate-50 p-3 rounded-xl border border-slate-100">
                   <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] shrink-0">3</span>
                   <span><b>New Tab:</b> If still failing, click the icon in the top right to open in a new tab.</span>
                </li>
             </ul>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex w-full h-screen bg-[#F5F5F7] font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="flex-none w-80 h-full bg-white border-r border-slate-200 flex flex-col">
        {/* Sidebar Header */}
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Activity className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-blue-600">Wifitel</h1>
          </div>
          <ProfileDialog profile={profile} onLogout={handleLogout} />
        </div>

        {/* Search / Add Friend */}
        <div className="px-4 py-2 flex items-center gap-2">
          <div className="flex-1 flex items-center bg-slate-100 rounded-xl px-3 py-2.5 border border-transparent focus-within:border-blue-300 transition-all">
            <Plus className="text-slate-400 w-4 h-4 mr-2" />
            <Input 
              placeholder="Look up ID (wt-XXXX)" 
              className="bg-transparent border-none outline-none text-sm w-full h-auto p-0 focus-visible:ring-0" 
            />
          </div>
          <AddFriendDialog onAdd={sendFriendRequest} />
        </div>

        {/* Tabs and Navigation */}
        <Tabs defaultValue="chats" className="flex-1 overflow-hidden mt-4 flex flex-col">
          <TabsList className="grid grid-cols-3 mx-4 mb-2 bg-slate-100 rounded-xl h-10 p-1">
            <TabsTrigger value="chats" className="rounded-lg text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-blue-600 shadow-none">Chats</TabsTrigger>
            <TabsTrigger value="updates" className="rounded-lg text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-blue-600 shadow-none relative">
              Updates
              {notificationsCount > 0 && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"></span>
              )}
            </TabsTrigger>
            <TabsTrigger value="calls" className="rounded-lg text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-blue-600 shadow-none">Calls</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1">
            <TabsContent value="chats" className="mt-0 space-y-0.5">
              <div className="px-6 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Chats</div>
              {contacts.map(c => (
                <div 
                  key={c.id} 
                  className={`flex items-center px-6 py-4 cursor-pointer transition-all hover:bg-slate-50 relative group ${activeChat?.id === c.id ? 'bg-blue-50 border-r-4 border-blue-600' : ''}`}
                  onClick={() => { setActiveChat(c); setView('chat'); }}
                >
                  <div className="relative mr-4">
                    <Avatar className="w-11 h-11 border border-slate-100">
                      <AvatarFallback className="text-xl bg-slate-50">{c.emoji}</AvatarFallback>
                    </Avatar>
                    {c.online && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                       <span className="font-semibold text-slate-900 truncate">{c.name}</span>
                       <span className="text-[10px] text-slate-400">12:45</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <p className="text-xs text-slate-500 truncate pr-4">Hey! Did you check the new update?</p>
                       {c.unreadCount > 0 && (
                        <Badge className="bg-blue-600 text-[10px] h-4 min-w-4 p-0.5 rounded-full flex items-center justify-center border-none">
                          {c.unreadCount}
                        </Badge>
                       )}
                    </div>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="updates" className="mt-0 p-4 space-y-3">
               <div className="px-2 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Friend Requests</div>
               {friendRequests.length === 0 ? (
                 <div className="text-center py-12 text-slate-400 text-xs italic">No pending requests</div>
               ) : (
                 friendRequests.map(r => (
                  <div key={r.id} className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100 transform transition hover:scale-[1.02]">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-xl shadow-inner">{r.fromEmoji}</div>
                      <div>
                        <p className="text-xs font-bold text-slate-800 uppercase tracking-tight">New Request</p>
                        <p className="text-sm text-slate-600 font-medium">{r.fromName}</p>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                       <Button className="flex-1 h-9 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20">Accept</Button>
                       <Button variant="ghost" className="flex-1 h-9 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-bold">Reject</Button>
                    </div>
                  </div>
                 ))
               )}
            </TabsContent>

            <TabsContent value="calls" className="mt-0 p-2 space-y-1">
               {callHistory.map(call => (
                 <div key={call.id} className="flex items-center justify-between p-4 rounded-2xl hover:bg-slate-50 transition-colors group">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${call.type === 'missed' ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500'}`}>
                        <Phone className={`w-5 h-5 ${call.type === 'incoming' ? 'rotate-180' : ''}`} />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">{call.contactName}</p>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">{call.timestamp} • {call.duration}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => startCall(call.id)}>
                      <Video className="w-5 h-5" />
                    </Button>
                 </div>
               ))}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative bg-white">
        <AnimatePresence mode="wait">
          {view === 'chat' && activeChat ? (
            <motion.div 
              key="chat-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex-1 flex flex-col h-full"
            >
              <header className="px-8 py-6 flex items-center justify-between border-b bg-white/80 backdrop-blur-xl sticky top-0 z-20">
                <div className="flex items-center gap-5">
                  <div className="relative">
                    <Avatar className="w-12 h-12 border-2 border-slate-50">
                      <AvatarFallback className="text-2xl font-bold bg-slate-50 leading-none">{activeChat.emoji}</AvatarFallback>
                    </Avatar>
                    <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-[3px] border-white rounded-full shadow-sm"></span>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 tracking-tight">{activeChat.name}</h2>
                    <p className="text-xs text-green-500 font-bold flex items-center gap-1.5 uppercase tracking-widest">
                       <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                       Connected • Online
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" size="icon" className="rounded-full w-11 h-11 border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-all" onClick={() => startCall(activeChat.id, 'audio')}><Phone className="w-5 h-5" /></Button>
                  <Button variant="outline" size="icon" className="rounded-full w-11 h-11 border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-all" onClick={() => startCall(activeChat.id, 'video')}><Video className="w-5 h-5" /></Button>
                  <Button variant="ghost" size="icon" className="rounded-full w-11 h-11 text-slate-400"><MoreVertical className="w-5 h-5" /></Button>
                </div>
              </header>

              <ScrollArea className="flex-1 px-8 py-8 bg-[#F8F9FB]">
                <div className="max-w-2xl mx-auto space-y-4">
                  {/* Date Separator */}
                  <div className="flex justify-center mb-4">
                    <span className="px-4 py-1.5 bg-slate-200/50 text-slate-500 text-[10px] font-bold rounded-full uppercase tracking-widest">Chat Session Started</span>
                  </div>

                  {messages.length === 0 ? (
                    <div className="text-center py-20 text-slate-300">
                      <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p className="text-xs font-bold uppercase tracking-[0.2em] italic">No messages yet</p>
                    </div>
                  ) : (
                    messages.map((msg, i) => (
                      <div key={msg.id || i} className={`flex ${msg.senderId === user.uid ? 'justify-end' : 'justify-start'} items-end gap-3`}>
                        {msg.senderId !== user.uid && (
                          <Avatar className="w-8 h-8 mb-1 shadow-sm border border-white">
                            <AvatarFallback className="bg-slate-200 text-[10px] font-bold">{activeChat.emoji}</AvatarFallback>
                          </Avatar>
                        )}
                        <div className={`p-4 rounded-2xl max-w-[75%] shadow-sm text-sm leading-relaxed overflow-hidden ${
                          msg.senderId === user.uid 
                            ? 'bg-blue-600 text-white rounded-br-none font-medium' 
                            : 'bg-white text-slate-700 rounded-bl-none font-medium border border-slate-100'
                        }`}>
                          {msg.text}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth' })} />
                </div>
              </ScrollArea>

              <div className="p-6 bg-white border-t border-slate-100 flex items-center justify-center">
                 <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem('msg') as HTMLInputElement;
                    sendMessage(input.value);
                    input.value = '';
                  }}
                  className="max-w-2xl w-full flex gap-3 p-2 bg-slate-100 rounded-2xl border border-slate-200 focus-within:border-blue-300 focus-within:bg-white transition-all shadow-sm"
                 >
                   <Button type="button" variant="ghost" size="icon" className="text-slate-400 rounded-xl"><Plus className="w-5 h-5" /></Button>
                   <Input 
                    name="msg"
                    autoComplete="off"
                    placeholder="Type a message..." 
                    className="bg-transparent border-none outline-none focus-visible:ring-0 text-slate-700 font-medium h-12 p-0 px-2" 
                   />
                   <Button type="submit" className="bg-blue-600 hover:bg-blue-700 w-12 h-12 rounded-xl p-0 shadow-md shadow-blue-500/20 shrink-0">
                     <Send className="w-5 h-5" />
                   </Button>
                 </form>
              </div>
            </motion.div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-[#F8F9FB]">
               <motion.div 
                 initial={{ scale: 0.5, opacity: 0 }}
                 animate={{ scale: 1, opacity: 1 }}
                 className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-2xl mb-8 ring-8 ring-blue-50 relative"
               >
                  <Activity className="text-blue-600 w-12 h-12" />
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1] }} 
                    transition={{ repeat: Infinity, duration: 2 }} 
                    className="absolute -top-2 -right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg"
                  >
                    LIVE
                  </motion.div>
               </motion.div>
               <h2 className="text-3xl font-extrabold text-slate-900 mb-4 tracking-tight">Congratulations! 🎉</h2>
               <p className="text-slate-600 max-w-sm text-base leading-relaxed mb-8">
                  Your **Wifitel** app is now fully integrated with your Firebase credentials. You are ready for high-performance video calls and secure messaging.
               </p>
               <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-md mb-2 border border-slate-100 italic font-serif">A+</div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quality</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-md mb-2 border border-slate-100">🔒</div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Secure</span>
                  </div>
               </div>
            </div>
          )}
        </AnimatePresence>

        {/* Call Overlay */}
        <AnimatePresence>
          {isCalling && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center text-white overflow-hidden"
            >
              {/* Remote Video (Full Screen) */}
              <video 
                ref={remoteVideoRef}
                autoPlay 
                playsInline
                className="absolute inset-0 w-full h-full object-cover opacity-80 mix-blend-lighten"
              />

              {/* Status Header Overlay */}
              <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-8 bg-gradient-to-b from-black/60 to-transparent">
                <div className="flex items-center space-x-5">
                  <Button variant="ghost" size="icon" className="rounded-full bg-white/10 hover:bg-white/20 text-white" onClick={endCall}>←</Button>
                  <div className="flex flex-col">
                    <div className="flex items-center space-x-3">
                      <span className="text-4xl leading-none">{activeCall?.callerEmoji || '👤'}</span>
                      <h2 className="text-white font-bold text-2xl tracking-tight">{activeCall?.callerName || 'Call'}</h2>
                    </div>
                    <span className="text-green-400 text-xs font-bold flex items-center mt-1 uppercase tracking-widest">
                      <span className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse shadow-[0_0_8px_rgba(74,222,128,1)]"></span>
                      {activeCall?.status === 'ringing' ? 'Calling...' : 'Secure Connection • 04:12'}
                    </span>
                  </div>
                </div>
                <div className="flex space-x-3">
                  <Button variant="outline" size="icon" className="w-12 h-12 rounded-full bg-white/5 border-white/10 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/15">🔊</Button>
                  <Button variant="outline" size="icon" className="w-12 h-12 rounded-full bg-white/5 border-white/10 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/15">📹</Button>
                </div>
              </div>

              {/* Local Video (Corner) */}
              <motion.div 
                drag
                dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
                className="absolute bottom-40 right-10 w-[160px] h-[240px] bg-slate-800 rounded-3xl border-2 border-white/10 shadow-2xl overflow-hidden z-20 cursor-move ring-1 ring-white/5"
              >
                <video 
                  ref={localVideoRef}
                  autoPlay 
                  muted 
                  playsInline 
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                {!localStreamRef.current && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800/80 backdrop-blur-sm">
                    <span className="text-4xl">👤</span>
                    <span className="text-[10px] text-white/50 mt-2 font-bold uppercase tracking-widest">Local View</span>
                  </div>
                )}
              </motion.div>

              {/* Call Controls Area */}
              <div className="absolute bottom-0 left-0 right-0 z-20 p-12 flex justify-center space-x-12 bg-gradient-to-t from-black/70 via-black/30 to-transparent backdrop-blur-[2px]">
                 {(activeCall?.status === 'ringing' && activeCall.receiverId === user.uid) && (
                   <div className="flex flex-col items-center gap-3">
                    <Button onClick={acceptCall} className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 shadow-[0_0_20px_rgba(34,197,94,0.4)] transform transition hover:scale-110 active:scale-95 border-none p-0 flex items-center justify-center">
                       <Phone className="w-8 h-8 text-white" />
                    </Button>
                    <span className="text-white text-[11px] font-black uppercase tracking-widest opacity-80">Accept</span>
                   </div>
                 )}
                 <div className="flex flex-col items-center gap-3">
                  <Button onClick={endCall} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.4)] transform transition hover:scale-110 active:scale-95 border-none p-0 flex items-center justify-center">
                     <X className="w-8 h-8 text-white" />
                  </Button>
                  <span className="text-white text-[11px] font-black uppercase tracking-widest opacity-80">End Call</span>
                 </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- Sub Dialogs ---

function ProfileDialog({ profile, onLogout }: any) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><Settings className="w-5 h-5 text-slate-500" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs rounded-3xl">
        <DialogHeader>
          <DialogTitle>Your Profile</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <span className="text-6xl">{profile?.emoji}</span>
          <div className="text-center">
            <h2 className="text-xl font-bold">{profile?.name}</h2>
            <p className="text-xs text-slate-400 font-mono tracking-widest">{profile?.friendId}</p>
          </div>
        </div>
        <DialogFooter>
           <Button onClick={onLogout} variant="destructive" className="w-full gap-2 rounded-xl">
             <LogOut className="w-4 h-4" /> Logout
           </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddFriendDialog({ onAdd }: { onAdd: (id: string) => void }) {
  const [friendId, setFriendId] = useState('');
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 bg-slate-100 rounded-xl w-10 h-10 flex items-center justify-center hover:bg-slate-200">
          <UserPlus className="w-5 h-5 text-slate-500" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs rounded-3xl">
        <DialogHeader>
          <DialogTitle>Add Friend</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Input 
            placeholder="WT-XXXX" 
            value={friendId}
            onChange={e => setFriendId(e.target.value)}
            className="rounded-xl border-slate-200"
          />
          <p className="text-[10px] text-slate-400 px-1 font-medium leading-relaxed uppercase tracking-widest">Ask your friend for their unique WT ID.</p>
        </div>
        <DialogFooter>
           <Button onClick={() => { onAdd(friendId); setFriendId(''); }} className="w-full bg-blue-600 rounded-xl gap-2 h-12 font-bold shadow-lg shadow-blue-500/20">
             <UserPlus className="w-4 h-4" /> Send Request
           </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
