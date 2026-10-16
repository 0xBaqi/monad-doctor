import { startHealthComparison } from '../../lib/health-coordinator.ts';
import { serializeHealthComparison } from '../../lib/health-comparison-response.ts';
import { FakeClock, automaticTransport, comparisonRequest, wallNow } from './health-coordinator.ts';

export async function comparisonFixture(variant = 'healthy', align = true) {
 const clock = new FakeClock(), normal = automaticTransport();
 const job = startHealthComparison(comparisonRequest(align), { clock, wallNow, runId: 'fixture-'+variant, admission: { release() {} }, fetcher: async (url,init) => {
  const request = JSON.parse(String(init?.body));
  const secondary = String(url).includes('rpc1.');
  const response = await normal(url,init), body = await response.json();
  if (variant === 'wrong-network' && request.method === 'eth_chainId') body.result = '0x1';
  if (variant === 'contradiction' && secondary && request.params[0] === 'finalized') body.result.hash = '0x'+'f'.repeat(64);
  if (variant === 'difference' && secondary && request.params[0] === 'latest') body.result.number = '0x70';
  if (variant === 'alignment' && secondary && request.params[0] === 'finalized') body.result.number = '0x63';
  if (variant === 'alignment' && request.params[0] === '0x63') body.result.number = '0x63';
  if (variant === 'inconsistent' && request.params[0] === 'latest') body.result.number = '0x1';
  if (variant === 'null' && secondary && request.params[0] === 'finalized') body.result = null;
  if (variant === 'incomplete' && secondary && request.params[0] === 'latest') throw new Error('UNSAFE_UPSTREAM_MARKER');
  return Response.json(body);
 } });
 if (variant === 'cancelled') job.cancel();
 const result = await job.result; await job.drained;
 if (result.kind !== 'comparison') throw new Error('Fixture did not produce a comparison');
 return { result, text: serializeHealthComparison(result) };
}
