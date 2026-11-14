import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useWorkspace } from '../../app/workspace';
import { Empty, Loading, Notice, PushLink, Segmented, Sheet, useToast } from '../../components/ui';
import { formatDateTime } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { ordersQuery } from '../../lib/sections';
import { rpc } from '../../lib/supabase';
import { ORDER_LABEL, type Order, type OrderStatus } from '../../lib/types';

type View = 'open' | 'done' | 'cancelled';
const OPEN: OrderStatus[] = ['pending', 'confirmed', 'paid'];

export function OrdersPage() {
  const { ws, can } = useWorkspace();
  const [view, setView] = useState<View>('open');
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const q = useQuery(ordersQuery(ws.id));
  const all = q.data ?? [];
  const open = all.filter((o) => OPEN.includes(o.status));
  const rows = view === 'open' ? open : all.filter((o) => (view === 'done' ? o.status === 'fulfilled' : o.status === 'cancelled'));

  return (
    <div className="stack lg">
      <div className="page-head"><h1>Orders</h1></div>
      <Segmented label="Show" value={view} onChange={setView}
        options={[{ value: 'open', label: `Open${open.length ? ` (${open.length})` : ''}` }, { value: 'done', label: 'Fulfilled' }, { value: 'cancelled', label: 'Cancelled' }]} />
      {q.isPending ? <Loading /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : rows.length === 0 ? (
        <div className="card"><Empty title="No orders here">{view === 'open' && 'Orders the AI or your team take in chat appear here.'}</Empty></div>
      ) : (
        <ul className="list card flush">
          {rows.map((o) => (
            <li key={o.id}>
              <button className="item" onClick={() => setOpenOrder(o)}>
                <span className="main-col">
                  <span className="title">{o.contacts.display_name}</span>
                  <span className="meta">
                    <span className={`pill ${o.status}`}>{ORDER_LABEL[o.status]}</span>
                    <span className="num">{o.order_no}</span>
                    <span>{o.items.map((i) => `${i.qty} × ${i.name}`).join(', ')}</span>
                  </span>
                </span>
                <span className="end-col"><strong className="num">{formatINR(o.total_paise)}</strong><span className="when">{o.created_by_ai ? 'by AI' : 'by team'}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openOrder && <OrderSheet order={openOrder} readOnly={!can('orders.write')} onClose={() => setOpenOrder(null)} />}
    </div>
  );
}

function OrderSheet({ order, readOnly, onClose }: { order: Order; readOnly: boolean; onClose: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const set = useMutation({
    mutationFn: (status: OrderStatus) => rpc<Order>('set_order_status', { p_ws: ws.id, p_order: order.id, p_status: status }),
    onSuccess: async (_o, status) => {
      await Promise.all(['orders', 'overview'].map((k) => qc.invalidateQueries({ queryKey: [k, ws.id] })));
      toast(`Order ${order.order_no} marked ${ORDER_LABEL[status].toLowerCase()}`); onClose();
    },
  });
  const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { pending: 'confirmed', confirmed: 'paid', paid: 'fulfilled' };
  const next = NEXT[order.status];
  return (
    <Sheet title={`Order ${order.order_no}`} onClose={onClose}>
      <div className="stack lg">
        <dl className="kv">
          <dt>Customer</dt><dd>{order.contacts.display_name}{order.contacts.phone ? ` · ${order.contacts.phone}` : ''}</dd>
          <dt>Status</dt><dd><span className={`pill ${order.status}`}>{ORDER_LABEL[order.status]}</span></dd>
          <dt>Taken</dt><dd>{formatDateTime(order.created_at, ws.timezone)} {order.created_by_ai ? 'by AI' : 'by team'}</dd>
          {order.items.map((i) => (<Fragment key={i.catalog_item_id}><dt>{i.qty} × {i.name}</dt><dd className="num">{formatINR(i.price_paise * i.qty)}</dd></Fragment>))}
          <dt>Total</dt><dd><strong className="num">{formatINR(order.total_paise)}</strong></dd>
          {order.note && <><dt>Note</dt><dd>{order.note}</dd></>}
        </dl>
        {set.error && <Notice tone="bad">{errorMessage(set.error)}</Notice>}
        {order.conversation_id && <PushLink className="btn block" to={`../inbox/${order.conversation_id}`} relative="path">Open chat</PushLink>}
        {!readOnly && next && <button className="btn primary block xl" disabled={set.isPending} onClick={() => set.mutate(next)}>{set.isPending ? <span className="spinner" /> : `Mark ${ORDER_LABEL[next].toLowerCase()}`}</button>}
        {!readOnly && OPEN.includes(order.status) && <button className="btn block ghost danger" disabled={set.isPending} onClick={() => set.mutate('cancelled')}>Cancel order</button>}
      </div>
    </Sheet>
  );
}
