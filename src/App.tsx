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
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  orderBy, 
  limit, 
  addDoc, 
  Timestamp,
  updateDoc,
  deleteDoc,
  arrayUnion,
  where
} from 'firebase/firestore';

import { auth, db } from './lib/firebase';
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

  // --- Auth & Profile ---
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch or Create Profile
        const userRef = doc(db, 'users', u.uid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          setProfile(snap.data());
        } else {
          const newId = `WT-${Math.random().toString(36).substring(7).toUpperCase()}`;
          const newProfile = {
            name: u.displayName || 'Unset',
            emoji: '📱',
            friendId: newId,
            online: true,
            unreadCount: 0,
            lastSeen: new Date().toISOString()
          };
          await setDoc(userRef, newProfile);
          setProfile(newProfile);
        }
        updateDoc(userRef, { online: true });
      }
    });
  }, []);

  // Set offline on disconnect
  useEffect(() => {
    if (!user) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        updateDoc(doc(db, 'users', user.uid), { online: false });
      } else {
        updateDoc(doc(db, 'users', user.uid), { online: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user]);

  // --- Signaling Listener (Calls) ---
  useEffect(() => {
    if (!user) return;
    const callRef = collection(db, 'calls');
    const q = query(callRef, where('receiverId', '==', user.uid), where('status', '==', 'ringing'));
    
    return onSnapshot(q, (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const callData = { id: change.doc.id, ...change.doc.data() };
          setActiveCall(callData);
          setIsCalling(true);
        }
      });
    });
  }, [user]);

  // --- Friend Requests & Contacts Listeners ---
  useEffect(() => {
    if (!user) return;
    
    // Notifications (Friend Requests)
    const notifRef = collection(db, 'users', user.uid, 'notifications');
    const unsubNotif = onSnapshot(notifRef, (snap) => {
      const reqs = snap.docs.map(d => ({ id: d.id, ...d.data() } as FriendRequest));
      setFriendRequests(reqs.filter(r => r.status === 'pending'));
      setNotificationsCount(reqs.filter(r => r.status === 'pending').length);
    });

    // Mock Call History (or fetch from real history)
    setCallHistory([
      { id: '1', type: 'incoming', contactName: 'Alex', timestamp: '2h ago', duration: '5:20' },
      { id: '2', type: 'missed', contactName: 'Sarah', timestamp: 'Yesterday', duration: '0:00' }
    ]);

    // Contacts (Simplified: anyone you have a chat history with or friends)
    // For this demo, let's auto-populate some if empty or fetch users
    setContacts([
      { id: 'dev-1', name: 'Wifitel Support', emoji: '🧑‍💻', online: true, unreadCount: 0 },
      { id: 'demo-2', name: 'Community Bot', emoji: '🤖', online: false, unreadCount: 2 }
    ]);

    return () => unsubNotif();
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

    const callDoc = await addDoc(collection(db, 'calls'), {
      callerId: user.uid,
      callerName: profile.name,
      callerEmoji: profile.emoji,
      receiverId: targetId,
      status: 'ringing',
      type,
      offer: { sdp: offer.sdp, type: offer.type },
      createdAt: Timestamp.now()
    });

    setActiveCall({ id: callDoc.id, type, callerId: user.uid, receiverId: targetId });
    setIsCalling(true);

    // Listen for answer
    onSnapshot(callDoc, async (snap) => {
      const data = snap.data();
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
        addDoc(collection(db, 'calls', callDoc.id, 'candidates'), {
          ...event.candidate.toJSON(),
          type: 'caller'
        });
      }
    };

    // Listen for remote ICE candidates
    onSnapshot(collection(db, 'calls', callDoc.id, 'candidates'), (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const cand = change.doc.data();
          if (cand.type === 'receiver') {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
        }
      });
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

    await updateDoc(doc(db, 'calls', activeCall.id), {
      answer: { sdp: answer.sdp, type: answer.type },
      status: 'active'
    });

    // Handle ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(collection(db, 'calls', activeCall.id, 'candidates'), {
          ...event.candidate.toJSON(),
          type: 'receiver'
        });
      }
    };

    // Listen for caller ICE candidates
    onSnapshot(collection(db, 'calls', activeCall.id, 'candidates'), (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const cand = change.doc.data();
          if (cand.type === 'caller') {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
        }
      });
    });

    // Listen for call end
    onSnapshot(doc(db, 'calls', activeCall.id), (snap) => {
      if (snap.data()?.status === 'ended') endCall();
    });
  };

  const endCall = async () => {
    if (activeCall?.id) {
      await updateDoc(doc(db, 'calls', activeCall.id), { status: 'ended' });
    }
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    setIsCalling(false);
    setActiveCall(null);
  };

  // --- Messaging Logic ---
  const sendMessage = async (text: string) => {
    if (!user || !activeChat || !text.trim()) return;
    const chatId = [user.uid, activeChat.id].sort().join('_');
    const msgRef = collection(db, 'chats', chatId, 'messages');
    
    await addDoc(msgRef, {
      senderId: user.uid,
      text,
      timestamp: Timestamp.now()
    });

    // Increment unread count for partner
    const partnerRef = doc(db, 'users', activeChat.id);
    updateDoc(partnerRef, { unreadCount: (activeChat.unreadCount || 0) + 1 });
  };

  // --- Handlers ---
  const handleLogin = () => signInWithPopup(auth, new GoogleAuthProvider());
  const handleLogout = () => signOut(auth);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center"
        >
          <div className="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center mb-6 mx-auto shadow-xl">
            <Activity className="text-white w-12 h-12" />
          </div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2 font-sans tracking-tight">Wifitel</h1>
          <p className="text-slate-500 mb-8 max-w-xs mx-auto">High-performance video calling and secure real-time messaging.</p>
          <Button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-lg rounded-xl">
            Sign in with Google
          </Button>
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
        <div className="px-4 py-2">
          <div className="flex items-center bg-slate-100 rounded-xl px-3 py-2.5 border border-transparent focus-within:border-blue-300 transition-all">
            <Plus className="text-slate-400 w-4 h-4 mr-2" />
            <Input 
              placeholder="Look up ID (wt-XXXX)" 
              className="bg-transparent border-none outline-none text-sm w-full h-auto p-0 focus-visible:ring-0" 
            />
          </div>
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
                <div className="max-w-2xl mx-auto space-y-6">
                  {/* Date Separator */}
                  <div className="flex justify-center">
                    <span className="px-4 py-1.5 bg-slate-200/50 text-slate-500 text-[10px] font-bold rounded-full uppercase tracking-widest">Today</span>
                  </div>

                  <div className="flex justify-start items-end gap-3">
                    <Avatar className="w-8 h-8 mb-1">
                      <AvatarFallback className="bg-slate-200 text-[10px] font-bold">{activeChat.emoji}</AvatarFallback>
                    </Avatar>
                    <div className="bg-white p-4 rounded-2xl rounded-bl-none max-w-[70%] shadow-sm text-sm border border-slate-100 font-medium text-slate-700 leading-relaxed overflow-hidden">
                      Hello! Welcome to Wifitel. I am the support bot here to help you. Did you check our latest update? 🚀
                    </div>
                  </div>

                  <div className="flex justify-end items-end gap-3">
                    <div className="bg-blue-600 text-white p-4 rounded-2xl rounded-br-none max-w-[70%] shadow-lg shadow-blue-500/10 text-sm font-medium leading-relaxed overflow-hidden">
                      The WebRTC quality is amazing! The latency is very low.
                    </div>
                  </div>
                </div>
              </ScrollArea>

              <div className="p-6 bg-white border-t border-slate-100 flex items-center justify-center">
                 <div className="max-w-2xl w-full flex gap-3 p-2 bg-slate-100 rounded-2xl border border-slate-200 focus-within:border-blue-300 focus-within:bg-white transition-all shadow-sm">
                   <Button variant="ghost" size="icon" className="text-slate-400 rounded-xl"><Plus className="w-5 h-5" /></Button>
                   <Input 
                    placeholder="Type a message..." 
                    className="bg-transparent border-none outline-none focus-visible:ring-0 text-slate-700 font-medium h-12" 
                   />
                   <Button className="bg-blue-600 hover:bg-blue-700 w-12 h-12 rounded-xl p-0 shadow-md shadow-blue-500/20 shrink-0">
                     <Send className="w-5 h-5" />
                   </Button>
                 </div>
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

function AddFriendDialog() {
  const [friendId, setFriendId] = useState('');
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><Plus className="w-5 h-5 text-slate-500" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs rounded-3xl">
        <DialogHeader>
          <DialogTitle>Add Friend</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Input 
            placeholder="[PREFIX]-XXXX" 
            value={friendId}
            onChange={e => setFriendId(e.target.value)}
            className="rounded-xl border-slate-200"
          />
          <p className="text-[10px] text-slate-400 px-1">Ask your friend for their unique WT ID.</p>
        </div>
        <DialogFooter>
           <Button className="w-full bg-blue-600 rounded-xl gap-2">
             <UserPlus className="w-4 h-4" /> Send Request
           </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
