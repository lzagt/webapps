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
      <div className="aacal-container" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="glass-panel border-accent text-center animate-fade-in" style={{ padding: '40px 30px', maxWidth: '400px' }}>
          <div className="logo-container" style={{ background: 'var(--delete-gradient)', marginBottom: '20px', display: 'inline-flex', boxShadow: '0 8px 24px rgba(239, 68, 68, 0.3)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#fff' }}>person_off</span>
          </div>
          <h2 className="text-gradient" style={{ fontSize: '24px', fontWeight: 800, marginBottom: '16px', fontFamily: "'Outfit', sans-serif" }}>No Kid Profile Selected</h2>
          <p className="text-secondary" style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.6 }}>Please specify a valid kid profile link to view achievements.</p>
          <Link to="/" className="btn btn-secondary" style={{ display: 'inline-flex', padding: '10px 20px', borderRadius: '20px', textDecoration: 'none', cursor: 'pointer' }}>
            Go to Portal Homepage
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="aacal-container">
        <div className="aacal-card text-center py-5">
          <p className="loading-text">Loading Achievements...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="aacal-container">
      {/* Header section */}
      <div className="aacal-card header-card flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link to={`/?userId=${userId}`} className="btn btn-secondary py-1 px-3 flex items-center gap-1" style={{ fontSize: '13px', display: 'flex', alignItems: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_back</span>
            Back
          </Link>
          <div>
            <h1 className="aacal-title" style={{ fontSize: '20px', margin: 0 }}>{userData?.title || 'AA Calendar'}</h1>
            <p className="aacal-subtitle" style={{ fontSize: '13px', margin: 0 }}>Achievements Wall 🏆</p>
          </div>
        </div>
        <div className="glow-pill font-bold flex items-center gap-2">
          <span>🌟 {totalCredits} Credits</span>
        </div>
      </div>

      {/* Stats Summary Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="aacal-card text-center p-4">
          <p className="text-secondary text-sm" style={{ margin: 0 }}>Total Gained Credits</p>
          <p className="text-2xl font-bold text-gradient mt-1" style={{ margin: '4px 0 0 0' }}>🌟 {totalCredits}</p>
        </div>
        <div className="aacal-card text-center p-4">
          <p className="text-secondary text-sm" style={{ margin: 0 }}>Tasks Achieved</p>
          <p className="text-2xl font-bold text-gradient mt-1" style={{ margin: '4px 0 0 0' }}>✓ {totalTasks}</p>
        </div>
      </div>

      {/* Parent Review Portal */}
      <div className="aacal-card mb-4 border-accent">
        <div className="flex justify-between items-center mb-3">
          <h2 className="section-title" style={{ fontSize: '16px', margin: 0 }}>Parent Review Portal 🔒</h2>
          {!isParentActive ? (
            <button className="btn btn-primary py-1 px-3 text-xs" style={{ cursor: 'pointer' }} onClick={() => setShowLogin(true)}>
              Unlock
            </button>
          ) : (
            <span className="badge-lag lag-on-time" style={{ fontSize: '10px' }}>Active</span>
          )}
        </div>

        {isParentActive ? (
          <div>
            {pendingAchievements.length === 0 ? (
              <p className="text-secondary text-center text-sm py-4">All caught up! No pending achievements to review.</p>
            ) : (
              <div className="review-list flex flex-col gap-2">
                {pendingAchievements.map(ach => (
                  <div key={ach.id} className="review-item flex justify-between items-center p-3 rounded-lg bg-surface border">
                    <div>
                      <h4 className="font-bold text-sm" style={{ margin: 0 }}>{ach.taskTitle}</h4>
                      <p className="text-xs text-secondary mt-1" style={{ margin: '4px 0 0 0' }}>
                        Checked-in: {getJsDate(ach.completedAt).toLocaleString()} ({ach.dayId})
                      </p>
                      <div className="flex gap-2 mt-2">
                        <span className="badge badge-credit">🌟 {ach.credits} Cr</span>
                        <span className={`badge badge-lag lag-${(ach.lagStatus || 'on-time').toLowerCase().replace(' ', '-')}`}>
                          {ach.lagStatus || 'On-Time'}
                        </span>
                      </div>
                    </div>
                    {/* Approve button only displayed when parent is logged in */}
                    <button className="btn btn-approve btn-success py-1 px-3 text-xs" style={{ cursor: 'pointer' }} onClick={() => handleApprove(ach.id)}>
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-secondary text-sm mb-3">
              {currentUser ? "You are signed in as a different parent. Please sign in as the correct parent." : "Unlock review controls to approve pending checklist rewards."}
            </p>
            <button className="btn btn-primary py-1.5 px-4 text-sm" style={{ cursor: 'pointer' }} onClick={() => setShowLogin(true)}>
              {currentUser ? "Switch Parent Account" : "Enter Parent Login"}
            </button>
          </div>
        )}
      </div>

      {/* Historical Achievements List */}
      <div className="aacal-card">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h2 className="section-title" style={{ fontSize: '16px', margin: 0 }}>Achievement Logs</h2>
          <div className="filter-tabs flex gap-1 bg-surface p-1 rounded-lg">
            <button
              className={`filter-btn px-3 py-1 rounded text-xs transition ${filter === 'all-time' ? 'bg-primary font-bold' : 'text-secondary'}`}
              onClick={() => setFilter('all-time')}
              style={{ cursor: 'pointer' }}
            >
              All Time
            </button>
            <button
              className={`filter-btn px-3 py-1 rounded text-xs transition ${filter === 'last-week' ? 'bg-primary font-bold' : 'text-secondary'}`}
              onClick={() => setFilter('last-week')}
              style={{ cursor: 'pointer' }}
            >
              Last Week
            </button>
            <button
              className={`filter-btn px-3 py-1 rounded text-xs transition ${filter === 'top-month' ? 'bg-primary font-bold' : 'text-secondary'}`}
              onClick={() => setFilter('top-month')}
              style={{ cursor: 'pointer' }}
            >
              Top Month
            </button>
          </div>
        </div>

        {filter === 'top-month' ? (
          <div>
            {topTasks.length === 0 ? (
              <p className="text-secondary text-center text-sm py-5">No achievements recorded in the last 30 days.</p>
            ) : (
              <div className="top-list flex flex-col gap-2">
                {topTasks.map((t, idx) => (
                  <div key={idx} className="top-item flex justify-between items-center p-3 rounded-lg bg-surface border">
                    <div className="flex items-center gap-3">
                      <span className="rank-badge">#{idx + 1}</span>
                      <div>
                        <h4 className="font-bold text-sm" style={{ margin: 0 }}>{t.taskTitle}</h4>
                        <p className="text-xs text-secondary mt-1" style={{ margin: '4px 0 0 0' }}>Completed {t.count} times</p>
                      </div>
                    </div>
                    <span className="font-bold text-sm text-gradient">🌟 +{t.credits} Credits</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {paginatedList.length === 0 ? (
              <p className="text-secondary text-center text-sm py-5">No achievements recorded for this filter range.</p>
            ) : (
              <div>
                <div className="history-list flex flex-col gap-2">
                  {paginatedList.map(ach => (
                    <div key={ach.id} className="history-item flex justify-between items-center p-3 rounded bg-surface border">
                      <div>
                        <h4 className="font-bold text-sm" style={{ margin: 0 }}>{ach.taskTitle}</h4>
                        <p className="text-xs text-secondary mt-1" style={{ margin: '4px 0 0 0' }}>
                          Completed: {getJsDate(ach.completedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="badge badge-credit text-xs">🌟 +{ach.credits} Cr</span>
                    </div>
                  ))}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button
                      className="btn btn-secondary py-1 px-3 text-xs"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      style={{ cursor: 'pointer' }}
                    >
                      Previous
                    </button>
                    <span className="text-secondary text-xs">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      className="btn btn-secondary py-1 px-3 text-xs"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      style={{ cursor: 'pointer' }}
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
