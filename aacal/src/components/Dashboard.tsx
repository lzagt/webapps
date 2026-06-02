import React, { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { collection, doc, onSnapshot, query, orderBy, updateDoc, setDoc, deleteDoc, serverTimestamp, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { DaySchedule, UserMetadata, Activity, Achievement } from '../types';
import { PinPrompt } from './PinPrompt';
import { Login } from './Login';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('userId') || '';
  
  const [userData, setUserData] = useState<UserMetadata | null>(null);
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  // Kids list for multi-profile selectors
  const [kidsList, setKidsList] = useState<{ id: string; title: string }[]>([]);
  const [checkingProfiles, setCheckingProfiles] = useState(!userId);

  
  // Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showGoals, setShowGoals] = useState(false);


  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubAuth();
  }, []);

  // Redirect or set kids list based on profiles owned by parent
  useEffect(() => {
    if (!currentUser) {
      setCheckingProfiles(false);
      return;
    }

    const fetchKids = async () => {
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('settings.parentId', '==', currentUser.uid));
        const snap = await getDocs(q);

        const profiles = snap.docs.map(doc => ({
          id: doc.id,
          title: doc.data().title || `${doc.id.toUpperCase()}'S PLANNER`
        }));

        setKidsList(profiles);

        if (!userId) {
          if (profiles.length === 0) {
            navigate('/onboarding', { replace: true });
          } else if (profiles.length === 1) {
            navigate(`/?userId=${profiles[0].id}`, { replace: true });
          } else {
            setCheckingProfiles(false);
          }
        } else {
          setCheckingProfiles(false);
        }
      } catch (err) {
        console.error("Failed to fetch profiles:", err);
        setCheckingProfiles(false);
      }
    };

    fetchKids();
  }, [currentUser, userId, navigate]);

  // Auto-redirect to onboarding if userId/empty and profile doesn't exist (first-time visitor)
  useEffect(() => {
    if (loading || checkingProfiles) return;

    if (!userData && !userId && !currentUser) {
      navigate('/onboarding', { replace: true });
    }
  }, [loading, userData, userId, navigate, checkingProfiles, currentUser]);



  // Focus day state & View Mode state
  const [focusedDayId, setFocusedDayId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'1' | '3' | '5' | '7'>('1');

  // PIN authentication state
  const [pinVerified, setPinVerified] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(`aacal_verified_${userId}`) === 'true';
    }
    return false;
  });

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const userRef = doc(db, 'users', userId);
    const unsubUser = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setUserData(doc.data() as UserMetadata);
      }
    });

    const scheduleRef = collection(db, 'users', userId, 'schedule');
    const q = query(scheduleRef, orderBy('order'));
    const unsubSchedule = onSnapshot(q, (snapshot) => {
      const days = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as DaySchedule[];
      setSchedule(days);
      setLoading(false);

      // Auto-focus today's weekday
      const todayName = new Date().toLocaleString('en-US', { weekday: 'long' });
      const todayDay = days.find(d => d.dayName.toLowerCase() === todayName.toLowerCase());
      if (todayDay) {
        setFocusedDayId(prev => prev || todayDay.id);
      } else if (days.length > 0) {
        setFocusedDayId(prev => prev || days[0].id);
      }
    });

    const achievementsRef = collection(db, 'users', userId, 'achievements');
    const unsubAchievements = onSnapshot(achievementsRef, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Achievement[];
      setAchievements(list);
    });

    return () => {
      unsubUser();
      unsubSchedule();
      unsubAchievements();
    };
  }, [userId]);

  const getLagStatus = (endTime?: string): 'On-Time' | 'A bit late' | 'Late' => {
    if (!endTime) return 'On-Time';
    const now = new Date();
    const checkInMinutes = now.getHours() * 60 + now.getMinutes();
    const [endHour, endMin] = endTime.split(':').map(Number);
    const endMinutes = endHour * 60 + endMin;
    const lag = checkInMinutes - endMinutes;
    if (lag <= 0) return 'On-Time';
    if (lag <= 15) return 'A bit late';
    return 'Late';
  };

  const toggleActivity = async (dayId: string, activityId: string, completed: boolean) => {
    const dayRef = doc(db, 'users', userId, 'schedule', dayId);
    const day = schedule.find(d => d.id === dayId);
    if (!day) return;

    const activity = day.activities.find(act => act.id === activityId);
    if (!activity) return;

    const updatedActivities = day.activities.map(act => {
      if (act.id === activityId) {
        return { ...act, completed: !completed };
      }
      return act;
    });

    await updateDoc(dayRef, { activities: updatedActivities });

    // Handle achievements log
    const dateStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const achievementId = `${dateStr}_${activityId}`;
    const achievementRef = doc(db, 'users', userId, 'achievements', achievementId);

    if (!completed) {
      // Toggling to completed -> create pending achievement
      const task = userData?.tasks?.find(t => t.id === activity.taskId);
      const taskTitle = task ? task.title : 'Unknown Task';
      const credits = activity.credits || 0;
      const lagStatus = getLagStatus(activity.endTime);

      await setDoc(achievementRef, {
        id: achievementId,
        activityId,
        taskId: activity.taskId,
        taskTitle,
        credits,
        completedAt: serverTimestamp(),
        date: dateStr,
        dayId,
        status: 'pending',
        lagStatus
      });
    } else {
      // Toggling to incomplete -> delete achievement log (both pending or approved)
      await deleteDoc(achievementRef);
    }
  };

  // Helper: dynamic period classification
  const getPeriod = (act: Activity): 'Morning' | 'Afternoon' | 'Evening' => {
    if (act.startTime) {
      const hour = parseInt(act.startTime.split(':')[0], 10);
      if (hour < 12) return 'Morning';
      if (hour < 17) return 'Afternoon';
      return 'Evening';
    }
    return 'Morning';
  };

  // Helper: beautifully display start/end time
  const formatTime = (time24?: string): string => {
    if (!time24) return '';
    const parts = time24.split(':');
    if (parts.length < 2) return time24;
    const h = parseInt(parts[0], 10);
    const mStr = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${mStr} ${ampm}`;
  };

  const getDisplayTime = (act: Activity): string => {
    if (act.startTime) {
      return act.endTime 
        ? `${formatTime(act.startTime)} - ${formatTime(act.endTime)}`
        : formatTime(act.startTime);
    }
    return '';
  };

  // Helper: sort activities chronologically
  const sortActivities = (activities: Activity[]): Activity[] => {
    return [...(activities || [])].sort((a, b) => {
      if (a.startTime && b.startTime) {
        return a.startTime.localeCompare(b.startTime);
      }
      return 0;
    });
  };

  const getJsDate = (ts: any) => {
    if (!ts) return new Date();
    if (ts.toDate) return ts.toDate();
    if (ts.seconds) return new Date(ts.seconds * 1000);
    return new Date(ts);
  };

  const isActivityApproved = (actId: string) => {
    const matching = achievements.filter(a => a.activityId === actId);
    if (matching.length === 0) return false;
    const latest = matching.reduce((latestSoFar, current) => {
      const timeL = getJsDate(latestSoFar.completedAt).getTime();
      const timeC = getJsDate(current.completedAt).getTime();
      return timeC > timeL ? current : latestSoFar;
    });
    return latest.status === 'approved';
  };

  // Helper: calculate day credits progress
  const dayCredits = (day: DaySchedule) => {
    return (day.activities || [])
      .filter(a => a.completed && a.credits && isActivityApproved(a.id))
      .reduce((sum, a) => sum + (a.credits || 0), 0);
  };

  const totalPossibleCredits = (day: DaySchedule) => {
    return (day.activities || [])
      .filter(a => a.credits)
      .reduce((sum, a) => sum + (a.credits || 0), 0);
  };

  // Navigation handlers
  const goToPrevDay = () => {
    const idx = schedule.findIndex(d => d.id === focusedDayId);
    if (idx === -1) return;
    const prevIdx = (idx - 1 + schedule.length) % schedule.length;
    setFocusedDayId(schedule[prevIdx].id);
  };

  const goToNextDay = () => {
    const idx = schedule.findIndex(d => d.id === focusedDayId);
    if (idx === -1) return;
    const nextIdx = (idx + 1) % schedule.length;
    setFocusedDayId(schedule[nextIdx].id);
  };

  const getTaskTitle = (taskId: string): string => {
    if (!userData || !userData.tasks) return '(Deleted Task)';
    const task = userData.tasks.find(t => t.id === taskId);
    return task ? task.title : '(Deleted Task)';
  };

  if (checkingProfiles) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] px-4">
        <div className="w-full max-w-md p-8 text-center rounded-3xl border border-violet-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="spinner mx-auto mb-6 w-10 h-10"></div>
          <h2 className="text-xl font-bold text-white tracking-tight">Checking Profiles...</h2>
        </div>
      </div>
    );
  }

  if (!userId && kidsList.length > 1) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] p-6">
        <div className="w-full max-w-2xl p-8 md:p-12 text-center rounded-3xl border border-violet-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-violet-600/10 border border-violet-500/25">
            <span className="material-symbols-outlined text-violet-400" style={{ fontSize: '32px' }}>family_restroom</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2 font-outfit">Select a Planner</h2>
          <p className="text-slate-300 mb-8 max-w-md mx-auto">
            Multiple kid profiles are linked to your account. Select one to view:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {kidsList.map(kid => (
              <button
                key={kid.id}
                onClick={() => navigate(`/?userId=${kid.id}`)}
                className="flex flex-col items-center gap-4 p-6 rounded-2xl border border-white/5 bg-slate-900/20 hover:bg-slate-900/40 hover:border-violet-500/50 hover:-translate-y-1 transition-all duration-300 cursor-pointer text-center group"
              >
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-violet-500/10 group-hover:scale-105 transition-transform">
                  {kid.id.charAt(0).toUpperCase()}
                </div>
                <div className="w-full">
                  <h3 className="text-base font-bold text-white truncate max-w-full">{kid.title.replace("'S PLANNER", "")}</h3>
                  <span className="text-xs text-slate-400">@{kid.id}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link to="/onboarding" className="nav-link btn-save">
              <span className="material-symbols-outlined">add_circle</span>
              Add Another Kid Profile
            </Link>
            <button 
              onClick={() => signOut(auth)} 
              className="nav-link btn-delete"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="flex items-center justify-center min-h-[80vh] text-slate-300 font-bold">Loading Planner...</div>;
  if (!userData) {
    if (!userId && !currentUser) {
      return (
        <div className="flex items-center justify-center min-h-[80vh] p-6">
          <div className="w-full max-w-md p-8 md:p-10 text-center rounded-3xl border border-violet-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-violet-600/10 border border-violet-500/25">
              <span className="material-symbols-outlined text-violet-400" style={{ fontSize: '32px' }}>child_care</span>
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-white mb-4 font-outfit">AAC Planner Portal</h2>
            <p className="text-slate-300 leading-relaxed mb-8">
              Welcome to the AAC Planner. Please authenticate as a parent to manage calendars, or use the direct public link provided by your parent to access Kid Mode.
            </p>
            <div className="flex justify-center">
              <button 
                onClick={() => setShowLogin(true)} 
                className="nav-link btn-save"
              >
                <span className="material-symbols-outlined">lock</span>
                Parent Portal Login
              </button>
            </div>
          </div>
          
          {showLogin && (
            <Login 
              onSuccess={() => setShowLogin(false)}
              onCancel={() => setShowLogin(false)}
            />
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-[80vh] p-6">
        <div className="w-full max-w-md p-8 md:p-10 text-center rounded-3xl border border-red-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-red-600/10 border border-red-500/25 shadow-lg shadow-red-500/10">
            <span className="material-symbols-outlined text-red-400" style={{ fontSize: '32px' }}>person_off</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white mb-4 font-outfit">Planner Not Found</h2>
          <p className="text-slate-300 leading-relaxed mb-8">
            The kid profile link <strong className="text-white">"{userId}"</strong> has not been set up in our system yet.
          </p>
          <div className="flex flex-col gap-4">
            <Link to="/onboarding" className="nav-link btn-save justify-center">
              <span className="material-symbols-outlined">add_circle</span>
              Create Kid Profile
            </Link>
            <Link to="/" className="nav-link justify-center">
              <span className="material-symbols-outlined">arrow_back</span>
              Go Back to Main Page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isParentActive = !!(currentUser && userData && userData.settings?.parentId === currentUser.uid);
  const requiresPin = userData.settings?.pin ? true : false;
  const isAuthorized = !requiresPin || pinVerified;

  if (!isAuthorized && userData.settings?.pin) {
    return (
      <PinPrompt
        correctPin={userData.settings.pin}
        title="Verification Required"
        onVerify={() => {
          setPinVerified(true);
          sessionStorage.setItem(`aacal_verified_${userId}`, 'true');
        }}
      />
    );
  }

  const currentDayName = new Date().toLocaleString('en-US', { weekday: 'long' });

  // Compute visible day cards
  const currentFocusIndex = schedule.findIndex(d => d.id === focusedDayId);
  let visibleDays: DaySchedule[] = [];
  if (schedule.length > 0 && currentFocusIndex !== -1) {
    if (viewMode === '1') {
      visibleDays = [schedule[currentFocusIndex]];
    } else if (viewMode === '3') {
      const idxs = [
        (currentFocusIndex - 1 + schedule.length) % schedule.length,
        currentFocusIndex,
        (currentFocusIndex + 1) % schedule.length
      ];
      visibleDays = idxs.map(i => schedule[i]).filter(Boolean);
    } else if (viewMode === '5') {
      const idxs = [
        (currentFocusIndex - 2 + schedule.length) % schedule.length,
        (currentFocusIndex - 1 + schedule.length) % schedule.length,
        currentFocusIndex,
        (currentFocusIndex + 1) % schedule.length,
        (currentFocusIndex + 2) % schedule.length
      ];
      visibleDays = idxs.map(i => schedule[i]).filter(Boolean);
    } else {
      visibleDays = schedule;
    }
  }

  // Compute overall reward scorecard for focused day (or active display)
  const focusedDay = schedule[currentFocusIndex];
  const activeDayEarned = focusedDay ? dayCredits(focusedDay) : 0;
  const activeDayPossible = focusedDay ? totalPossibleCredits(focusedDay) : 0;

  const getGridClass = () => {
    if (viewMode === '1') return "grid grid-cols-1 max-w-2xl mx-auto gap-8 mb-12 animate-fade-in";
    if (viewMode === '3') return "grid grid-cols-1 md:grid-cols-3 gap-8 mb-12 animate-fade-in";
    if (viewMode === '5') return "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-12 animate-fade-in";
    return "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-6 mb-12 animate-fade-in";
  };

  return (
    <div className="app-container px-4 py-8">
      {/* Top Status & Brand Header Row */}
      <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between w-full mb-10">
        <div className="flex items-center gap-4">
          <div className="logo-container flex-shrink-0">
            <span className="material-symbols-outlined">calendar_today</span>
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white leading-tight font-outfit">{userData.title || 'WEEKLY PLANNER'}</h1>
            <p className="text-slate-400 text-sm font-medium">{userData.subtitle || 'Daily Checklist'}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {activeDayPossible > 0 && (
            <div className="credits-scorecard shadow-lg">
              <span className="material-symbols-outlined star-icon">grade</span>
              <span className="credits-text text-sm">
                <strong>{focusedDay?.dayName}</strong>: <strong>{activeDayEarned}</strong> / {activeDayPossible} Credits
              </span>
            </div>
          )}

          {isParentActive ? (
            <div className="flex items-center gap-3">
              <span className="badge-lag lag-on-time flex items-center gap-1 text-[11px]">
                <span className="material-symbols-outlined text-[14px]">lock_open</span>
                Parent Mode
              </span>
              <button 
                onClick={() => signOut(auth)} 
                className="nav-link py-2 px-4 text-xs font-bold hover:bg-red-500/20 hover:text-red-300"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {currentUser && (
                <span className="badge-lag lag-late flex items-center gap-1 text-[11px]">
                  Wrong Parent
                </span>
              )}
              <button 
                onClick={() => setShowLogin(true)} 
                className="nav-link py-2 px-4 text-xs font-bold flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">lock</span>
                Parent Login
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Navigation & Controls Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between w-full mb-10 pb-6 border-b border-white/5">
        <div className="view-mode-selector">
          {(['1', '3', '5', '7'] as const).map((mode) => (
            <button
              key={mode}
              className={`selector-btn ${viewMode === mode ? 'active' : ''}`}
              onClick={() => setViewMode(mode)}
            >
              {mode === '1' ? '1 Day' : `${mode} Days`}
            </button>
          ))}
        </div>

        {viewMode !== '7' && schedule.length > 0 && (
          <div className="day-navigator">
            <button className="nav-arrow-btn" onClick={goToPrevDay}>
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <span className="focused-day-display font-semibold">
              {focusedDay?.dayName || 'Select Day'}
            </span>
            <button className="nav-arrow-btn" onClick={goToNextDay}>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <Link to={`/achievements?userId=${userId}`} className="nav-link py-2.5 px-5 text-sm font-semibold">
            <span className="material-symbols-outlined">emoji_events</span>
            Achievements
          </Link>

          {isParentActive && (
            <Link to={`/edit?userId=${userId}`} className="nav-link btn-save py-2.5 px-5 text-sm font-semibold">
              <span className="material-symbols-outlined">edit</span>
              Edit Planner
            </Link>
          )}
        </div>
      </div>

      {/* Main Days Grid */}
      <main className={getGridClass()}>
        {visibleDays.map((day) => {
          const isToday = day.dayName.toLowerCase() === currentDayName.toLowerCase();
          const earned = dayCredits(day);
          const possible = totalPossibleCredits(day);

          return (
            <div 
              key={day.id} 
              className={`day-card flex flex-col justify-between ${isToday ? 'today-highlight ring-2 ring-violet-500/30' : 'border border-white/5'}`} 
              id={isToday ? 'today' : day.id}
            >
              <div>
                <div className="day-header flex justify-between items-start mb-6 pb-4 border-b border-white/5">
                  <div className="flex flex-col gap-1">
                    <span className="day-name text-2xl font-extrabold text-white tracking-tight font-outfit">{day.dayName}</span>
                    {possible > 0 && (
                      <span className="day-credits-badge self-start text-[11px] font-bold">
                        ⭐ {earned}/{possible} Credits
                      </span>
                    )}
                  </div>
                  {isToday && <span className="today-badge">Today</span>}
                </div>

                <div className="flex flex-col gap-6">
                  {['Morning', 'Afternoon', 'Evening'].map((period) => {
                    const periodActs = sortActivities(day.activities || [])
                      .filter(a => getPeriod(a) === period);
                    
                    if (periodActs.length === 0) return null;

                    return (
                      <div key={period} className="flex flex-col gap-3">
                        <div className={`period-title period-${period} self-start text-[10.5px] font-extrabold tracking-wider`}>
                          {period}
                        </div>
                        <div className="activity-list">
                          {periodActs.map((act) => (
                            <div key={act.id} className={`activity-item ${act.completed ? 'completed' : ''}`}>
                              <button 
                                className="checkbox-btn"
                                onClick={() => toggleActivity(day.id, act.id, act.completed)}
                              >
                                <span className="material-symbols-outlined">check</span>
                              </button>
                              <div className="activity-content">
                                <div className="activity-main-line flex items-center justify-between w-full">
                                  <span className="activity-time text-slate-400 font-bold text-[11px]">{getDisplayTime(act)}</span>
                                  {act.credits ? (
                                    <span className="activity-credit-tag text-[9px] font-bold">⭐ +{act.credits}</span>
                                  ) : null}
                                </div>
                                <span className="activity-text text-sm font-semibold text-white">{getTaskTitle(act.taskId)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </main>

      {userData.goals && userData.goals.length > 0 && (
        <button 
          className="goals-fab" 
          onClick={() => setShowGoals(true)}
          title="View Weekly Goals"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'var(--accent-gradient)',
            color: '#ffffff',
            border: 'none',
            boxShadow: '0 8px 32px var(--accent-glow)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>track_changes</span>
        </button>
      )}

      {showGoals && userData.goals && userData.goals.length > 0 && (
        <div className="login-modal-overlay" onClick={() => setShowGoals(false)}>
          <div 
            className="glass-panel w-full max-w-md p-6 rounded-3xl border border-violet-500/20 bg-slate-900/90 backdrop-blur-xl shadow-2xl animate-fade-in" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-4 mb-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-violet-400" style={{ fontSize: '24px' }}>track_changes</span>
                <h3 className="text-xl font-extrabold text-white font-outfit">Weekly Goals &amp; Habits</h3>
              </div>
              <button 
                onClick={() => setShowGoals(false)} 
                className="btn btn-secondary p-1.5 min-w-0 rounded-full border border-white/10 hover:bg-white/5 cursor-pointer flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-slate-400" style={{ fontSize: '18px' }}>close</span>
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {userData.goals.map((goal, i) => (
                <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-white/5 bg-slate-950/40">
                  <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: '20px' }}>task_alt</span>
                  <span className="text-sm font-medium text-slate-200">{goal}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showLogin && (
        <Login 
          onSuccess={() => setShowLogin(false)} 
          onCancel={() => setShowLogin(false)} 
        />
      )}
    </div>
  );
};
