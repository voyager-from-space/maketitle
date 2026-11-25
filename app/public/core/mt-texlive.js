// maketitle: the one data package BusyTeX mounts. Instead of a 200-300 MB file-system image it asks mt-lazy.js to create
// the TeX Live tree from its index (small config files for real, the rest as lazy nodes that fetch on first read).
(() => {
  var Module = typeof BusytexPipeline != 'undefined' ? BusytexPipeline : {};
  function runWithFS(M) {
    M['addRunDependency']('mt-texlive');
    self.__mtReady.then(() => { MtLazy.mount(M); M['removeRunDependency']('mt-texlive'); },
      (err) => { self.postMessage({ exception: 'Could not load the TeX Live index: ' + err }); });
  }
  if (Module['calledRun']) runWithFS(Module);
  else { if (!Module['preRun']) Module['preRun'] = []; Module['preRun'].push(runWithFS); }
})();
