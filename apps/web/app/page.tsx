import HomeClient from './components/HomeClient';
import styles from './page.module.css';

export default function HomePage() {
  return (
    <section>
      <div className={styles.hero}>
        <p>Welcome to the Timeline Demo.</p>
        <h1 className={styles.heroTitle}>A polished front-end for timeline-aware experiences.</h1>
        <p>
          Navigate across events, calendar snapshots, and chat to see how the mock APIs power the
          UI. Every panel handles loading, errors, and empty states gracefully.
        </p>
      </div>
      <HomeClient />
    </section>
  );
}
