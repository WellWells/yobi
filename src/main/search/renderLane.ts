import { Semaphore } from '../flow/lanes';

export const searchRenderLane = new Semaphore(2);
