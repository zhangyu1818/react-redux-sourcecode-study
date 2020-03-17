import React, { useMemo, useEffect } from "react";
import PropTypes from "prop-types";
import { ReactReduxContext } from "./Context";
import Subscription from "../utils/Subscription";

function Provider({ store, context, children }) {
  // useMemo仅在store变化时再重新返回
  const contextValue = useMemo(() => {
    const subscription = new Subscription(store);
    // 通知订阅这个subscription的子级刷新
    // 也就是在所有第一层级的组件
    //    <Provider store={store}>
    //        <Component/> // 它的子级就订阅的它
    //        <Component/>
    //        <Component/>
    //     </Provider>
    subscription.onStateChange = subscription.notifyNestedSubs;
    subscription.componentName = "Provider";
    return {
      store,
      subscription
    };
  }, [store]);

  // 缓存上次的state
  const previousState = useMemo(() => store.getState(), [store]);

  useEffect(() => {
    const { subscription } = contextValue;
    subscription.trySubscribe();
    if (previousState !== store.getState()) {
      subscription.notifyNestedSubs();
    }
    return () => {
      subscription.tryUnsubscribe();
      subscription.onStateChange = null;
    };
  }, [contextValue, previousState, store]);

  // 传入的context或者自带的
  const Context = context || ReactReduxContext;

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
}

if (process.env.NODE_ENV !== "production") {
  Provider.propTypes = {
    store: PropTypes.shape({
      subscribe: PropTypes.func.isRequired,
      dispatch: PropTypes.func.isRequired,
      getState: PropTypes.func.isRequired
    }),
    context: PropTypes.object,
    children: PropTypes.any
  };
}

export default Provider;
