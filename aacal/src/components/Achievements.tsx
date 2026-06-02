import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { Achievement, UserMetadata } from '../types';
import { Login } from './Login';

export const Achievements: React.FC = () => {
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('userId') || '';

  const [userData, setUserData] = useState<UserMetadata | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all-time' | 'last-week' | 'top-month'>('all-time');
  
  // Auth states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 8; // mobile friendly count

  useEffect(() => {
    if (!userId) return;

    // Listen to user metadata
    const userRef = doc(db, 'users', userId);
    const unsubUser = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setUserData(doc.data() as UserMetadata);
      }
    });

    // Listen to achievements subcollection
    const achievementsRef = collection(db, 'users', userId, 'achievements');
    const unsubAchievements = onSnapshot(achievementsRef, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Achievement[];
      setAchievements(list);
      setLoading(false);
    });

    // Listen to Auth state
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });

    return () => {
      unsubUser();
      unsubAchievements();
      unsubAuth();
    };
  }, [userId]);

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const isParentActive = !!(currentUser && userData && userData.settings?.parentId === currentUser.uid);

  const handleApprove = async (id: string) => {
    // Prevent execution if not authorized parent
    if (!isParentActive) {
      console.warn("Unauthorized approval attempt.");
      return;
    }
    const docRef = doc(db, 'users', userId, 'achievements', id);
    await updateDoc(docRef, {
      status: 'approved',
      approvedAt: serverTimestamp()
    });
  };

  const getJsDate = (ts: any) => {
    if (!ts) return new Date();
    if (ts.toDate) return ts.toDate();
    if (ts.seconds) return new Date(ts.seconds * 1000);
    return new Date(ts);
  };

  // 1. Calculations: Approved stats
  const approvedAchievements = achievements.filter(a => a.status === 'approved');
  const pendingAchievements = achievements.filter(a => a.status === 'pending');

  const totalCredits = approvedAchievements.reduce((sum, a) => sum + (a.credits || 0), 0);
  const totalTasks = approvedAchievements.length;

  // 2. Calculations: Filtered lists
  const now = new Date();
  const getFilteredApprovedList = () => {
    if (filter === 'all-time') {
      return [...approvedAchievements].sort((a, b) => getJsDate(b.completedAt).getTime() - getJsDate(a.completedAt).getTime());
    }

    if (filter === 'last-week') {
      return approvedAchievements
        .filter(a => {
          const date = getJsDate(a.completedAt);
          const diff = Math.abs(now.getTime() - date.getTime());
          const diffDays = Math.ceil(diff / (1000 * 60 * 60 * 24));
          return diffDays <= 7;
        })
        .sort((a, b) => getJsDate(b.completedAt).getTime() - getJsDate(a.completedAt).getTime());
    }

    return []; // top-month is handled separately by aggregation
  };

  // Top tasks last month (30 days) aggregation
  const getTopTasksLastMonth = () => {
    const last30Days = approvedAchievements.filter(a => {
      const date = getJsDate(a.completedAt);
      const diff = Math.abs(now.getTime() - date.getTime());
      const diffDays = Math.ceil(diff / (1000 * 60 * 60 * 24));
      return diffDays <= 30;
    });

    const groups: { [key: string]: { taskTitle: string; credits: number; count: number } } = {};
    last30Days.forEach(a => {
      const key = a.taskTitle || 'Unknown';
      if (!groups[key]) {
        groups[key] = { taskTitle: key, credits: 0, count: 0 };
      }
      groups[key].credits += a.credits || 0;
      groups[key].count += 1;
    });

    return Object.values(groups).sort((a, b) => b.credits - a.credits);
  };

  const filteredList = getFilteredApprovedList();
  const topTasks = getTopTasksLastMonth();

  // Paginated lists
  const paginatedList = filteredList.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const totalPages = Math.ceil(filteredList.length / ITEMS_PER_PAGE);

  if (!userId) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] p-6">
        <div className="w-full max-w-md p-8 text-center rounded-3xl border border-red-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-red-600/10 border border-red-500/25 shadow-lg shadow-red-500/10">
            <span className="material-symbols-outlined text-red-400" style={{ fontSize: '32px' }}>person_off</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2 font-outfit">No Kid Profile Selected</h2>
          <p className="text-slate-300 leading-relaxed mb-6">Please specify a valid kid profile link to view achievements.</p>
          <Link to="/" className="nav-link justify-center">
            Go to Portal Homepage
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] text-slate-300 font-bold">
        Loading Achievements...
      </div>
    );
  }

  return (
    <div className="aacal-container py-8">
      {/* Header section */}
      <div className="aacal-card flex items-center justify-between p-6 rounded-2xl bg-slate-900/40 border border-white/5">
        <div className="flex items-center gap-4">
          <Link to={`/?userId=${userId}`} className="nav-link py-2 px-4 text-xs font-bold inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">arrow_back</span>
            Calendar
          </Link>
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight leading-tight font-outfit">{userData?.title || 'AA Calendar'}</h2>
            <p className="text-slate-400 text-md font-medium">Achievements Wall 🏆</p>
          </div>
        </div>
        <div className="glow-pill">
          <span>🌟 {totalCredits} Credits</span>
        </div>
      </div>

      {/* Stats Summary Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="aacal-card p-6 text-center flex flex-col justify-center items-center">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Total Gained Credits</p>
          <p className="text-3xl font-extrabold text-white font-outfit">🌟 {totalCredits}</p>
        </div>
        <div className="aacal-card p-6 text-center flex flex-col justify-center items-center">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Tasks Achieved</p>
          <p className="text-3xl font-extrabold text-white font-outfit">✓ {totalTasks}</p>
        </div>
      </div>

      {/* Parent Review Portal */}
      <div className="aacal-card border-accent p-6 rounded-2xl bg-slate-900/40">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/5">
          <h2 className="text-base font-extrabold text-white tracking-tight font-outfit">Parent Review Portal 🔒</h2>
          {!isParentActive ? (
            <button 
              className="nav-link py-1.5 px-3 text-xs font-bold" 
              onClick={() => setShowLogin(true)}
            >
              Unlock
            </button>
          ) : (
            <span className="badge-lag lag-on-time text-[10px] font-bold">Active</span>
          )}
        </div>

        {isParentActive ? (
          <div>
            {pendingAchievements.length === 0 ? (
              <p className="text-slate-400 text-center text-sm py-6">All caught up! No pending achievements to review.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {pendingAchievements.map(ach => (
                  <div key={ach.id} className="flex justify-between items-center p-4 rounded-xl bg-slate-950/40 border border-white/5">
                    <div className="flex flex-col gap-1.5">
                      <h4 className="font-bold text-sm text-white">{ach.taskTitle}</h4>
                      <p className="text-xs text-slate-400">
                        Checked-in: {getJsDate(ach.completedAt).toLocaleString()} ({ach.dayId})
                      </p>
                      <div className="flex gap-2">
                        <span className="badge-credit text-[10px] font-bold">🌟 {ach.credits} Cr</span>
                        <span className={`badge-lag lag-${(ach.lagStatus || 'on-time').toLowerCase().replace(' ', '-')} text-[10px]`}>
                          {ach.lagStatus || 'On-Time'}
                        </span>
                      </div>
                    </div>
                    <button 
                      className="nav-link btn-save py-2 px-4 text-xs font-bold" 
                      onClick={() => handleApprove(ach.id)}
                    >
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 flex flex-col items-center justify-center">
            <p className="text-slate-400 text-sm mb-4 max-w-sm">
              {currentUser ? "You are signed in as a different parent. Please sign in as the correct parent." : "Unlock review controls to approve pending checklist rewards."}
            </p>
            <button 
              className="nav-link btn-save py-2 px-5 text-xs font-bold" 
              onClick={() => setShowLogin(true)}
            >
              {currentUser ? "Switch Parent Account" : "Enter Parent Login"}
            </button>
          </div>
        )}
      </div>

      {/* Historical Achievements List */}
      <div className="aacal-card p-6 rounded-2xl bg-slate-900/40 border border-white/5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 pb-4 border-b border-white/5">
          <h2 className="text-base font-extrabold text-white tracking-tight font-outfit">Achievement Logs</h2>
          
          <div className="filter-tabs flex gap-1 p-1 bg-slate-950/80 border border-white/5 rounded-xl">
            {(['all-time', 'last-week', 'top-month'] as const).map(f => (
              <button
                key={f}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${filter === f ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all-time' ? 'All Time' : f === 'last-week' ? 'Last Week' : 'Top Month'}
              </button>
            ))}
          </div>
        </div>

        {filter === 'top-month' ? (
          <div>
            {topTasks.length === 0 ? (
              <p className="text-slate-400 text-center text-sm py-8">No achievements recorded in the last 30 days.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {topTasks.map((t, idx) => (
                  <div key={idx} className="flex justify-between items-center p-4 rounded-xl bg-slate-950/40 border border-white/5">
                    <div className="flex items-center gap-3">
                      <span className="rank-badge">#{idx + 1}</span>
                      <div>
                        <h4 className="font-bold text-sm text-white">{t.taskTitle}</h4>
                        <p className="text-xs text-slate-400 mt-1">Completed {t.count} times</p>
                      </div>
                    </div>
                    <span className="font-bold text-sm text-yellow-300">🌟 +{t.credits} Credits</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {paginatedList.length === 0 ? (
              <p className="text-slate-400 text-center text-sm py-8">No achievements recorded for this filter range.</p>
            ) : (
              <div>
                <div className="flex flex-col gap-2.5">
                  {paginatedList.map(ach => (
                    <div key={ach.id} className="flex justify-between items-center p-4 rounded-xl bg-slate-950/40 border border-white/5">
                      <div>
                        <h4 className="font-bold text-sm text-white">{ach.taskTitle}</h4>
                        <p className="text-xs text-slate-400 mt-1">
                          Completed: {getJsDate(ach.completedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="badge-credit text-xs">🌟 +{ach.credits} Cr</span>
                    </div>
                  ))}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/5">
                    <button
                      className="nav-link py-1.5 px-3 text-xs font-bold"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    >
                      Previous
                    </button>
                    <span className="text-slate-400 text-xs font-semibold">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      className="nav-link py-1.5 px-3 text-xs font-bold"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Parent Login modal */}
      {showLogin && (
        <Login
          onSuccess={() => setShowLogin(false)}
          onCancel={() => setShowLogin(false)}
        />
      )}
    </div>
  );
};
