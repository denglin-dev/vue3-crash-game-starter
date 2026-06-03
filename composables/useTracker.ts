export function useTracker() {
  return {
    track,
    startTimer,
    endTimer,
    
    // 结束计时并发送埋点
    trackWithStay: (eventCode: string) => {
      const stayTime = endTimer(eventCode)
      track(eventCode, stayTime)
    }
  }
}
