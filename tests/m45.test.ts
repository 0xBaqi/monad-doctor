import test from 'node:test';
import assert from 'node:assert/strict';
import {BodyTimeoutError,createRpc,readBounded} from '../lib/rpc.ts';
import {quantity} from '../lib/validation.ts';
test('body deadline is explicitly a timeout even before the fetch abort callback runs',async()=>{
 const body=new ReadableStream<Uint8Array>({start(){}});
 await assert.rejects(readBounded(body,1024,5),BodyTimeoutError);
 const rpc=createRpc('primary',{fetcher:async()=>{throw new BodyTimeoutError('synthetic stalled body');}});
 const result=await rpc.call('eth_chainId',[],quantity);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'TIMEOUT');
});
