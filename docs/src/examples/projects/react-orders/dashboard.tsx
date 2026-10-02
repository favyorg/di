import { useEffect, useState } from 'react';
import type { DashboardData } from './api-types';

type Props = { load: (fail: boolean) => Promise<DashboardData> };

export function Dashboard({ load }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    void load(false).then(
      (value) => {
        if (mounted) {
          setData(value);
          setLoading(false);
        }
      },
      (cause: unknown) => {
        if (mounted) {
          setError(String(cause));
          setLoading(false);
        }
      }
    );
    return () => {
      mounted = false;
    };
  }, [load]);

  async function reload(fail: boolean) {
    setLoading(true);
    setError('');
    try {
      setData(await load(fail));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <span className="eyebrow">React + dependency injection</span>
      <h1>Orders dashboard</h1>
      <p className="lead">
        Two services, one application. Change the API mock in app.tsx and run
        again.
      </p>
      <div className="toolbar">
        <button
          className="button"
          disabled={loading}
          onClick={() => void reload(false)}
        >
          Reload orders
        </button>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => void reload(true)}
        >
          Simulate API error
        </button>
      </div>
      <p className="status" role="status">
        {loading ? 'Loading user and orders…' : 'Request complete'}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <section
          className="card"
          aria-label="Order summary"
          aria-busy={loading}
        >
          <div className="grid">
            <div>
              <span className="label">Customer</span>
              <strong className="metric">{data.user.name}</strong>
            </div>
            <div>
              <span className="label">Orders</span>
              <strong className="metric">{data.orders.length}</strong>
            </div>
          </div>
          <ul className="rows">
            {data.orders.map((order) => (
              <li key={order.id}>
                <span>Order #{order.id}</span>
                <strong>${order.total.toFixed(2)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="note">
        Main depends on User and Orders tags. Their implementations receive the
        mock API at startup.
      </p>
    </main>
  );
}
