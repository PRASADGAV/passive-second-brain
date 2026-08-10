import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWebSocket } from './hooks/useWebSocket';
import { useGraph } from './hooks/useGraph';
import { ThemeProvider } from './context/ThemeContext';

import Cursor        from './components/Cursor';
import LandingPage   from './components/LandingPage';
import Dashboard     from './components/Dashboard';
import BrainGraphPage from './components/BrainGraphPage';
import ChatPage      from './components/ChatPage';
import DigestPage    from './components/DigestPage';
import AddPage       from './components/AddPage';
import GapsPage      from './components/GapsPage';
import ReportPage    from './components/ReportPage';
import PrivacyPage   from './components/PrivacyPage';
import TimelinePage  from './components/TimelinePage';
import InsightsPage  from './components/InsightsPage';
import ReviewPage    from './components/ReviewPage';
import SpiralGraphPage from './components/SpiralGraphPage';

const PAGE = {
  LANDING:  'landing',
  DASHBOARD:'dashboard',
  BRAIN:    'brain',
  SPIRAL:   'spiral',
  CHAT:     'chat',
  DIGEST:   'digest',
  ADD:      'add',
  GAPS:     'gaps',
  REPORT:   'report',
  PRIVACY:  'privacy',
  TIMELINE: 'timeline',
  INSIGHTS: 'insights',
  REVIEW:   'review',
};

const pageVariants = {
  initial: { opacity: 0, x: 40 },
  animate: { opacity: 1, x: 0,  transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, x: -30, transition: { duration: 0.22, ease: 'easeIn' } },
};

const dashVariants = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1,   transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, scale: 0.96, transition: { duration: 0.22 } },
};

function AppInner() {
  const [page, setPage] = useState(() =>
    localStorage.getItem('engram_onboarded') === 'true' ? PAGE.DASHBOARD : PAGE.LANDING
  );

  const { connected, on } = useWebSocket();
  const { addNode, addEdge } = useGraph();

  useEffect(() => {
    on('node_added', d => { if (d.node) addNode(d.node); });
    on('edge_added', d => { if (d.edge) addEdge(d.edge); });
  }, [on, addNode, addEdge]);

  const fromLanding = useCallback(() => {
    localStorage.setItem('engram_onboarded', 'true');
    setPage(PAGE.DASHBOARD);
  }, []);

  const fromDashboard = useCallback(id => {
    const map = {
      brain:    PAGE.BRAIN,
      chat:     PAGE.CHAT,
      digest:   PAGE.DIGEST,
      add:      PAGE.ADD,
      gaps:     PAGE.GAPS,
      report:   PAGE.REPORT,
      privacy:  PAGE.PRIVACY,
      timeline: PAGE.TIMELINE,
      insights: PAGE.INSIGHTS,
      review:   PAGE.REVIEW,
    };
    if (map[id]) setPage(map[id]);
  }, []);

  const backToDash = useCallback(() => setPage(PAGE.DASHBOARD), []);

  return (
    <>
      <Cursor />
      <AnimatePresence mode="wait">

        {page === PAGE.LANDING && (
          <motion.div key="landing" style={{ position: 'fixed', inset: 0 }}
            variants={dashVariants} initial="initial" animate="animate" exit="exit">
            <LandingPage onEnter={fromLanding} />
          </motion.div>
        )}

        {page === PAGE.DASHBOARD && (
          <motion.div key="dashboard" style={{ position: 'fixed', inset: 0 }}
            variants={dashVariants} initial="initial" animate="animate" exit="exit">
            <Dashboard onNavigate={fromDashboard} wsConnected={connected} />
          </motion.div>
        )}

        {page === PAGE.BRAIN && (
          <motion.div key="brain" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <BrainGraphPage onBack={backToDash} onSpiralView={() => setPage(PAGE.SPIRAL)} />
          </motion.div>
        )}

        {page === PAGE.SPIRAL && (
          <motion.div key="spiral" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <SpiralGraphPage onBack={backToDash} onSwitchView={() => setPage(PAGE.BRAIN)} />
          </motion.div>
        )}

        {page === PAGE.CHAT && (
          <motion.div key="chat" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <ChatPage onBack={backToDash} />
          </motion.div>
        )}

        {page === PAGE.DIGEST && (
          <motion.div key="digest" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <DigestPage onBack={backToDash} />
          </motion.div>
        )}

        {page === PAGE.ADD && (
          <motion.div key="add" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <AddPage onBack={backToDash} />
          </motion.div>
        )}

        {page === PAGE.GAPS && (
          <motion.div key="gaps" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <GapsPage onBack={backToDash} />
          </motion.div>
        )}

        {page === PAGE.REPORT && (
          <motion.div key="report" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <ReportPage onBack={backToDash} />
          </motion.div>
        )}

        {page === PAGE.PRIVACY && (
          <motion.div key="privacy" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <PrivacyPage onBack={backToDash} />
          </motion.div>
        )}

        {page === PAGE.TIMELINE && (
          <motion.div key="timeline" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <TimelinePage onBack={backToDash} />
          </motion.div>
        )}

        {page === PAGE.INSIGHTS && (
          <motion.div key="insights" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <InsightsPage onBack={backToDash} />
          </motion.div>
        )}

        {page === PAGE.REVIEW && (
          <motion.div key="review" style={{ position: 'fixed', inset: 0 }}
            variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <ReviewPage onBack={backToDash} />
          </motion.div>
        )}

      </AnimatePresence>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
