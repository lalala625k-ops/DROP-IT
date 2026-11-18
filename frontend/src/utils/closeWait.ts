export type CloseWaitChoice = 'wait' | 'force' | 'cancel';

/** A timeout offers a choice; it never turns a late disk result into consent. */
export function waitForClose(work: Promise<boolean>, options: {
  deciding: () => boolean; prompt: () => Promise<CloseWaitChoice>; dismiss: () => void;
  delay?: number; schedule?: typeof setTimeout; cancel?: typeof clearTimeout;
}): Promise<boolean> {
  const schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true; cancel(timer); options.dismiss(); resolve(value);
    };
    const arm = () => { timer = schedule(() => void check(), options.delay ?? 15000); };
    const check = async () => {
      if (settled) return;
      if (options.deciding()) { arm(); return; }
      try {
        const answer = await options.prompt();
        if (settled) return;
        if (answer === 'wait') arm();
        else finish(answer === 'force');
      } catch (error) {
        if (!settled) { settled = true; options.dismiss(); reject(error); }
      }
    };
    work.then(finish, error => {
      if (!settled) { settled = true; cancel(timer); options.dismiss(); reject(error); }
    });
    arm();
  });
}
