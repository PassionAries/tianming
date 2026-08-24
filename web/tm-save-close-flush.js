// tm-save-close-flush.js — 应用关闭前同时排空 canonical 后台保存与桌面恢复镜像。
// 【装载序】必须紧随 tm-save-lifecycle.js；共享其世界事务、队列和自动档运行态。
(function(global){
  'use strict';

  async function awaitDesktopAutoSave(reason){
    if (!_tmHasNativeFs()) return {ok:true,skipped:true,reason:'desktop-autosave-unavailable'};
    if (isWorldTransactionActive()) return {ok:false,code:'world-transaction-active',reason:'回合、读档或回滚事务仍在进行'};
    if (_autoSaveFlushTimer) { clearTimeout(_autoSaveFlushTimer); _autoSaveFlushTimer=null; }
    var result={ok:true,skipped:true,reason:'desktop-autosave-not-pending'};
    var drains=0;
    while (_autoSaveInFlightPromise||_autoSaveInFlight||_autoSaveDeferred) {
      if (++drains>4) return {ok:false,code:'desktop-autosave-drain-limit',reason:'桌面自动存档镜像超过关闭前排空上限'};
      if (_autoSaveInFlightPromise) result=await _autoSaveInFlightPromise;
      else if (_autoSaveInFlight) return {ok:false,code:'desktop-autosave-untracked-in-flight',reason:'桌面自动存档存在无法等待的在途写入'};
      else {
        _autoSaveDeferred=false;
        result=await _tmRunDesktopAutoSaveTick({force:true,reason:reason||'application-close'});
      }
      if (!(result&&result.ok===true)) {
        _autoSaveDeferred=true;
        return {
          ok:false,
          code:'desktop-autosave-flush-failed',
          reason:String(result&&(result.reason||(result.error&&result.error.message))||'桌面自动存档镜像写入失败'),
          result:result
        };
      }
      if (_autoSaveFlushTimer) { clearTimeout(_autoSaveFlushTimer); _autoSaveFlushTimer=null; }
    }
    return {ok:true,reason:'desktop-autosave-flushed',result:result,drains:drains};
  }

  async function flushForClose(){
    if (isWorldTransactionActive()) return {ok:false,code:'world-transaction-active',reason:'回合、读档或回滚事务仍在进行'};
    try {
      var result=await _tmAwaitBackgroundAutosaves();
      if (_backgroundSavePending||_backgroundSaveInFlight) return {ok:false,code:'background-save-still-pending',reason:'后台保存队列尚未清空'};
      if (result&&result.error) return {ok:false,code:'background-save-flush-failed',reason:result.error&&result.error.message||String(result.error)};
      var desktopResult=await awaitDesktopAutoSave('application-close');
      if (!(desktopResult&&desktopResult.ok===true)) {
        return {
          ok:false,
          code:String(desktopResult&&desktopResult.code||'desktop-autosave-flush-failed'),
          reason:String(desktopResult&&(desktopResult.reason||(desktopResult.error&&desktopResult.error.message))||'桌面自动存档镜像尚未安全完成')
        };
      }
      return {ok:true,reason:result&&result.reason||'background-saves-flushed',desktopAutoSave:desktopResult};
    } catch(error) {
      try {
        if (global.TM&&TM.errors&&typeof TM.errors.captureSilent==='function') TM.errors.captureSilent(error,'background-save-close-flush');
      } catch(reportError) {
        console.warn('[background-save] 关闭握手错误记录失败:',reportError&&reportError.message||reportError);
      }
      return {ok:false,code:'background-save-flush-exception',reason:error&&error.message||String(error)};
    }
  }

  function install(){
    if (!_tmHasNativeFs()||!global.tianming||typeof global.tianming.onAppCloseFlushRequest!=='function') return false;
    if (typeof global._tmCloseFlushBridgeDisposer==='function') return true;
    var disposer=global.tianming.onAppCloseFlushRequest(function(){ return flushForClose(); });
    if (typeof disposer!=='function') throw new Error('desktop close flush bridge did not return a disposer');
    global._tmCloseFlushBridgeDisposer=disposer;
    return true;
  }

  global._tmAwaitDesktopAutoSaveForClose=awaitDesktopAutoSave;
  global._tmFlushBackgroundAutosavesForClose=flushForClose;
  global._tmInstallDesktopCloseFlushBridge=install;
  try { install(); }
  catch(error) { console.warn('[background-save] 桌面关闭握手安装失败:',error&&error.message||error); }
})(window);
