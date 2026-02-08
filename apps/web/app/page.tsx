import HomeClient from './components/HomeClient';
import styles from './page.module.css';

export default function HomePage() {
  return (
    <section>
      <div className={styles.hero}>
        <p>Welcome to the Timeline Demo.</p>
        <h1 className={styles.heroTitle}>A polished front-end for timeline-aware experiences.</h1>
        <p>
          Connect your accounts, pick the Gmail and Drive sources you want to summarize, then explore
          Timeline and Calendar views that stay in sync with Drive-backed artifacts.
        </p>
      </div>
      <HomeClient />
    </section>
  );
}
