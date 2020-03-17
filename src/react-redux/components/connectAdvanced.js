import hoistStatics from "hoist-non-react-statics";
import React, { useContext, useMemo, useRef, useReducer } from "react";
import { isValidElementType, isContextConsumer } from "react-is";
import Subscription from "../utils/Subscription";
import { useIsomorphicLayoutEffect } from "../utils/useIsomorphicLayoutEffect";

import { ReactReduxContext } from "./Context";

// Define some constant arrays just to avoid re-creating these
// 使用useReducer的初始值
const EMPTY_ARRAY = [];
// 组件不被订阅的值
const NO_SUBSCRIPTION_ARRAY = [null, null];

const stringifyComponent = Comp => {
  try {
    return JSON.stringify(Comp);
  } catch (err) {
    return String(Comp);
  }
};

//useReducer的reducer
function storeStateUpdatesReducer(state, action) {
  const [, updateCount] = state;
  return [action.payload, updateCount + 1];
}

function useIsomorphicLayoutEffectWithArgs(
  effectFunc,
  effectArgs,
  dependencies
) {
  useIsomorphicLayoutEffect(() => effectFunc(...effectArgs), dependencies);
}

function captureWrapperProps(
  lastWrapperProps,
  lastChildProps,
  renderIsScheduled,
  wrapperProps,
  actualChildProps,
  childPropsFromStoreUpdate,
  notifyNestedSubs
) {
  // We want to capture the wrapper props and child props we used for later comparisons
  // 存下来用于下次的比较
  lastWrapperProps.current = wrapperProps;
  lastChildProps.current = actualChildProps;
  renderIsScheduled.current = false;
  // If the render was from a store update, clear out that reference and cascade the subscriber update
  // 如果更新来自store，则清空引用并且通知子级更新
  if (childPropsFromStoreUpdate.current) {
    childPropsFromStoreUpdate.current = null;
    notifyNestedSubs();
  }
}

function subscribeUpdates(
  // 是否需要更新
  shouldHandleStateChanges,
  store,
  // Subscription的实例
  subscription,
  // connect的selector
  childPropsSelector,
  // 上一次传入组件的props
  lastWrapperProps,
  // 上一次的props包括组件的props，store props，dispatch props
  lastChildProps,
  renderIsScheduled,
  childPropsFromStoreUpdate,
  notifyNestedSubs,
  forceComponentUpdateDispatch
) {
  // If we're not subscribed to the store, nothing to do here
  // 不需要更新
  if (!shouldHandleStateChanges) return;
  // Capture values for checking if and when this component unmounts
  let didUnsubscribe = false;
  let lastThrownError = null;
  // We'll run this callback every time a store subscription update propagates to this component
  // 每当store的订阅更新传递到此组件都会运行这个回调
  const checkForUpdates = () => {
    if (didUnsubscribe) {
      // Don't run stale listeners.
      // Redux doesn't guarantee unsubscriptions happen until next dispatch.
      // redux不能保证在下次dispatch前取消订阅
      return;
    }

    // 新的state
    const latestStoreState = store.getState();

    let newChildProps, error;
    try {
      // Actually run the selector with the most recent store state and wrapper props
      // to determine what the child props should be
      // 获取新的child props
      newChildProps = childPropsSelector(
        latestStoreState,
        lastWrapperProps.current
      );
    } catch (e) {
      error = e;
      lastThrownError = e;
    }

    if (!error) {
      lastThrownError = null;
    }

    // If the child props haven't changed, nothing to do here - cascade the subscription update
    // 如果child props没有变就什么都不做
    if (newChildProps === lastChildProps.current) {
      // 即便自己没变，也要通知订阅自己的子级去检查更新
      if (!renderIsScheduled.current) {
        notifyNestedSubs();
      }
    } else {
      // Save references to the new child props.  Note that we track the "child props from store update"
      // as a ref instead of a useState/useReducer because we need a way to determine if that value has
      // been processed.  If this went into useState/useReducer, we couldn't clear out the value without
      // forcing another re-render, which we don't want.
      // 把新的child props存下来，使用ref而不是useState/useReducer是因为我们需要一种方式确定值是否已经被处理
      // 如果用useState/useReducer，我们不能在不强制更新的情况下清除值，这不是我们想要的
      lastChildProps.current = newChildProps;
      childPropsFromStoreUpdate.current = newChildProps;
      renderIsScheduled.current = true;

      // If the child props _did_ change (or we caught an error), this wrapper component needs to re-render
      // 如果child props改变或者捕获了错误，这个wrapper component都需要重新渲染
      forceComponentUpdateDispatch({
        type: "STORE_UPDATED",
        payload: {
          error
        }
      });
    }
  };

  // Actually subscribe to the nearest connected ancestor (or store)
  // 实际订阅的是最近的父级或者是store
  subscription.onStateChange = checkForUpdates;
  // 订阅
  subscription.trySubscribe();

  // Pull data from the store after first render in case the store has
  // changed since we began.
  // 第一次渲染完成后从store里拿数据
  checkForUpdates();

  // 退订
  const unsubscribeWrapper = () => {
    didUnsubscribe = true;
    subscription.tryUnsubscribe();
    subscription.onStateChange = null;

    if (lastThrownError) {
      // It's possible that we caught an error due to a bad mapState function, but the
      // parent re-rendered without this component and we're about to unmount.
      // This shouldn't happen as long as we do top-down subscriptions correctly, but
      // if we ever do those wrong, this throw will surface the error in our tests.
      // In that case, throw the error from here so it doesn't get lost.
      throw lastThrownError;
    }
  };

  return unsubscribeWrapper;
}

// useReducer惰性初始化
const initStateUpdates = () => [null, 0];

export default function connectAdvanced(
  /*
    selectorFactory is a func that is responsible for returning the selector function used to
    compute new props from state, props, and dispatch. For example:

      export default connectAdvanced((dispatch, options) => (state, props) => ({
        thing: state.things[props.thingId],
        saveThing: fields => dispatch(actionCreators.saveThing(props.thingId, fields)),
      }))(YourComponent)

    Access to dispatch is provided to the factory so selectorFactories can bind actionCreators
    outside of their selector as an optimization. Options passed to connectAdvanced are passed to
    the selectorFactory, along with displayName and WrappedComponent, as the second argument.

    Note that selectorFactory is responsible for all caching/memoization of inbound and outbound
    props. Do not use connectAdvanced directly without memoizing results between calls to your
    selector, otherwise the Connect component will re-render on every state or props change.
  */
  selectorFactory,
  // options object:
  {
    // the func used to compute this HOC's displayName from the wrapped component's displayName.
    // probably overridden by wrapper functions such as connect()
    // 这个函数通过wrapped component的displayName来计算HOC的displayName
    // 可能会被wrapper functions例如connect() 覆盖
    getDisplayName = name => `ConnectAdvanced(${name})`,

    // shown in error messages
    // probably overridden by wrapper functions such as connect()
    // 在error messages里显示
    methodName = "connectAdvanced",

    // REMOVED: if defined, the name of the property passed to the wrapped element indicating the number of
    // calls to render. useful for watching in react devtools for unnecessary re-renders.
    renderCountProp = undefined,

    // determines whether this HOC subscribes to store changes
    // false的时候dispatch里组件也不会更新
    shouldHandleStateChanges = true,

    // REMOVED: the key of props/context to get the store
    storeKey = "store",

    // REMOVED: expose the wrapped component via refs
    withRef = false,

    // use React's forwardRef to expose a ref of the wrapped component
    // 是否传递ref
    forwardRef = false,

    // the context consumer to use
    // 使用的context consumer
    context = ReactReduxContext,

    // additional options are passed through to the selectorFactory
    // 其他值将传递给selectorFactory
    ...connectOptions
  } = {}
) {
  if (process.env.NODE_ENV !== "production") {
    if (renderCountProp !== undefined) {
      throw new Error(
        `renderCountProp is removed. render counting is built into the latest React Dev Tools profiling extension`
      );
    }
    if (withRef) {
      throw new Error(
        "withRef is removed. To access the wrapped instance, use a ref on the connected component"
      );
    }

    const customStoreWarningMessage =
      "To use a custom Redux store for specific components, create a custom React context with " +
      "React.createContext(), and pass the context object to React Redux's Provider and specific components" +
      " like: <Provider context={MyContext}><ConnectedComponent context={MyContext} /></Provider>. " +
      "You may also pass a {context : MyContext} option to connect";

    if (storeKey !== "store") {
      throw new Error(
        "storeKey has been removed and does not do anything. " +
          customStoreWarningMessage
      );
    }
  }

  // context
  const Context = context;
  // 实际connect调用的函数，WrappedComponent就是传入的组件
  return function wrapWithConnect(WrappedComponent) {
    // 验证组件
    if (
      process.env.NODE_ENV !== "production" &&
      !isValidElementType(WrappedComponent)
    ) {
      throw new Error(
        `You must pass a component to the function returned by ` +
          `${methodName}. Instead received ${stringifyComponent(
            WrappedComponent
          )}`
      );
    }

    // 传入组件的名字，在react插件上看得到
    const wrappedComponentName =
      WrappedComponent.displayName || WrappedComponent.name || "Component";
    const displayName = getDisplayName(wrappedComponentName);

    // 传递给selectorFactory
    const selectorFactoryOptions = {
      ...connectOptions,
      getDisplayName,
      methodName,
      renderCountProp,
      shouldHandleStateChanges,
      storeKey,
      displayName,
      wrappedComponentName,
      WrappedComponent
    };
    // 是否缓存值
    const { pure } = connectOptions;

    // 封装一下selectorFactory
    function createChildSelector(store) {
      return selectorFactory(store.dispatch, selectorFactoryOptions);
    }
    // If we aren't running in "pure" mode, we don't want to memoize values.
    // To avoid conditionally calling hooks, we fall back to a tiny wrapper
    // that just executes the given callback immediately.
    // pure模式下用useMemo，否则直接回调
    const usePureOnlyMemo = pure ? useMemo : callback => callback();

    // 这是渲染在页面上的组件
    function ConnectFunction(props) {
      const [propsContext, forwardedRef, wrapperProps] = useMemo(() => {
        // Distinguish between actual "data" props that were passed to the wrapper component,
        // and values needed to control behavior (forwarded refs, alternate context instances).
        // To maintain the wrapperProps object reference, memoize this destructuring.
        // 区分传入的props和控制行为的值（forward ref，替换的context实例）
        const { forwardedRef, ...wrapperProps } = props;
        return [props.context, forwardedRef, wrapperProps];
      }, [props]);
      // 用组件传入的context还是react redux的context
      const ContextToUse = useMemo(() => {
        // Users may optionally pass in a custom context instance to use instead of our ReactReduxContext.
        // Memoize the check that determines which context instance we should use.
        // 缓存应该使用自带的context还是用户传入的context
        return propsContext &&
          propsContext.Consumer &&
          isContextConsumer(<propsContext.Consumer />)
          ? propsContext
          : Context;
      }, [propsContext, Context]);
      // Retrieve the store and ancestor subscription via context, if available
      // 从context里取store和subscription
      const contextValue = useContext(ContextToUse);
      // The store _must_ exist as either a prop or in context.
      // We'll check to see if it _looks_ like a Redux store first.
      // This allows us to pass through a `store` prop that is just a plain value.
      // store必须在props或者context里存在，所以需要先判断是不是存在
      // 我们可以直接把store传给组件
      const didStoreComeFromProps =
        Boolean(props.store) &&
        Boolean(props.store.getState) &&
        Boolean(props.store.dispatch);
      const didStoreComeFromContext =
        Boolean(contextValue) && Boolean(contextValue.store);
      if (
        process.env.NODE_ENV !== "production" &&
        !didStoreComeFromProps &&
        !didStoreComeFromContext
      ) {
        throw new Error(
          `Could not find "store" in the context of ` +
            `"${displayName}". Either wrap the root component in a <Provider>, ` +
            `or pass a custom React context provider to <Provider> and the corresponding ` +
            `React context consumer to ${displayName} in connect options.`
        );
      }

      // Based on the previous check, one of these must be true
      // 取出store
      const store = didStoreComeFromProps ? props.store : contextValue.store;

      const childPropsSelector = useMemo(() => {
        // The child props selector needs the store reference as an input.
        // Re-create this selector whenever the store changes.
        // createChildSelector需要store作为参数,在store改变的时候会重新创建
        return createChildSelector(store);
      }, [store]);
      const [subscription, notifyNestedSubs] = useMemo(() => {
        // 这时候组件不会随store变化更新
        if (!shouldHandleStateChanges)
          return NO_SUBSCRIPTION_ARRAY; /* [ null, null ] */
        // This Subscription's source should match where store came from: props vs. context. A component
        // connected to the store via props shouldn't use subscription from context, or vice versa.
        // 如果组件的store是从props里来的，就不需要传入context里的subscription
        // 通过这个订阅store来让组件更新
        const subscription = new Subscription(
          store,
          // contextValue.subscription这个值，在Provider根是store的subscription，其余情况都是父级的subscription
          // 因为每次connect返回的组件外面包的Provider都使用了新的value
          //   <Provider store={store}>
          //     <Test4> // store的subscription
          //       <Test5 /> // Test4的subscription
          //     </Test4>
          //     <Test6 /> // store的subscription
          //   </Provider>
          // todo 为什么订阅父级connect的subscription，如果都订阅store的也会更新组件
          didStoreComeFromProps ? null : contextValue.subscription
        );
        subscription.componentName = wrappedComponentName;
        // `notifyNestedSubs` is duplicated to handle the case where the component is unmounted in
        // the middle of the notification loop, where `subscription` will then be null. This can
        // probably be avoided if Subscription's listeners logic is changed to not call listeners
        // that have been unsubscribed in the  middle of the notification loop.
        // 防止在通知循环中组件被unmount
        const notifyNestedSubs = subscription.notifyNestedSubs.bind(
          subscription
        );
        return [subscription, notifyNestedSubs];
      }, [store, didStoreComeFromProps, contextValue]);

      // Determine what {store, subscription} value should be put into nested context, if necessary,
      // and memoize that value to avoid unnecessary context updates.
      // 将subscription放入context后的context
      // 因为多层connect嵌套会把subscription传给子级connect
      const overriddenContextValue = useMemo(() => {
        if (didStoreComeFromProps) {
          // This component is directly subscribed to a store from props.
          // We don't want descendants reading from this store - pass down whatever
          // the existing context value is from the nearest connected ancestor.
          // 如果组件订阅的是从props里的store，我们不希望子级从这个store里获取任何东西
          return contextValue;
        }

        // Otherwise, put this component's subscription instance into context, so that
        // connected descendants won't update until after this component is done
        // 否则将当前组件的subscription放入context里，确保子组件在当前组件更新完之前不会更新
        return {
          ...contextValue,
          subscription
        };
      }, [didStoreComeFromProps, contextValue, subscription]);

      // We need to force this wrapper component to re-render whenever a Redux store update
      // causes a change to the calculated child component props (or we caught an error in mapState)
      // 我们需要在redux store更新的时候强制让包装组件更新
      // **正常情况下组件重新的渲染就是因为调用了forceComponentUpdateDispatch，而调用这个就是在订阅的事件中**
      const [
        [previousStateUpdateResult],
        forceComponentUpdateDispatch
      ] = useReducer(storeStateUpdatesReducer, EMPTY_ARRAY, initStateUpdates);
      // Propagate any mapState/mapDispatch errors upwards
      // 捕获更新产生的错误
      if (previousStateUpdateResult && previousStateUpdateResult.error) {
        throw previousStateUpdateResult.error;
      }

      // Set up refs to coordinate values between the subscription effect and the render logic
      // 会赋值等于actualChildProps，也就是包括了store，dispatch和传入组件的props
      const lastChildProps = useRef();
      // 传入组件的props
      const lastWrapperProps = useRef(wrapperProps);
      const childPropsFromStoreUpdate = useRef();
      const renderIsScheduled = useRef(false);
      const actualChildProps = usePureOnlyMemo(() => {
        // Tricky logic here:
        // - This render may have been triggered by a Redux store update that produced new child props
        // 这次渲染也许是因为redux store更新产生了新props触发的
        // - However, we may have gotten new wrapper props after that
        // 然而，我们也可能在这之后得到父级传入的props
        // If we have new child props, and the same wrapper props, we know we should use the new child props as-is.
        // 如果我们得到一个新的child props，和一个相同的父级传入的props，我们知道我们应该使用新的child props
        // But, if we have new wrapper props, those might change the child props, so we have to recalculate things.
        // 但是，如果父级传入了一个新的props，可能会改变child props，所以我们需要重新计算
        // So, we'll use the child props from store update only if the wrapper props are the same as last time.
        // 所以，如果父级的props和上次相同，我们我们会使用从store更新来的新props
        if (
          childPropsFromStoreUpdate.current &&
          wrapperProps === lastWrapperProps.current
        ) {
          return childPropsFromStoreUpdate.current;
        }

        // TODO We're reading the store directly in render() here. Bad idea?
        // This will likely cause Bad Things (TM) to happen in Concurrent Mode.
        // Note that we do this because on renders _not_ caused by store updates, we need the latest store state
        // to determine what the child props should be.
        return childPropsSelector(store.getState(), wrapperProps);
        // 主要因为previousStateUpdateResult的改变，才会重新计算actualChildProps
      }, [store, previousStateUpdateResult, wrapperProps]);
      // We need this to execute synchronously every time we re-render. However, React warns
      // about useLayoutEffect in SSR, so we try to detect environment and fall back to
      // just useEffect instead to avoid the warning, since neither will run anyway.
      // useIsomorphicLayoutEffectWithArgs会根据是服务端还是浏览器端来决定到底调用useEffect还是useLayoutEffect
      // 这里主要是初始化值，用做以后更新时的对比
      // 还有就是调用自身的notifyNestedSubs,让子组件也更新
      useIsomorphicLayoutEffectWithArgs(captureWrapperProps, [
        lastWrapperProps,
        lastChildProps,
        renderIsScheduled,
        wrapperProps,
        actualChildProps,
        childPropsFromStoreUpdate,
        notifyNestedSubs
      ]);
      // Our re-subscribe logic only runs when the store/subscription setup changes
      // 只会在store或者subscription改变时候重新订阅
      // 这里主要绑定订阅事件
      useIsomorphicLayoutEffectWithArgs(
        subscribeUpdates,
        [
          shouldHandleStateChanges,
          store,
          subscription,
          childPropsSelector,
          lastWrapperProps,
          lastChildProps,
          renderIsScheduled,
          childPropsFromStoreUpdate,
          notifyNestedSubs,
          forceComponentUpdateDispatch
        ],
        [store, subscription, childPropsSelector]
      );

      // Now that all that's done, we can finally try to actually render the child component.
      // We memoize the elements for the rendered child component as an optimization.
      // 下面2个组件用useMemo来优化
      const renderedWrappedComponent = useMemo(
        () => <WrappedComponent {...actualChildProps} ref={forwardedRef} />,
        [forwardedRef, WrappedComponent, actualChildProps]
      );

      // If React sees the exact same element reference as last time, it bails out of re-rendering
      // that child, same as if it was wrapped in React.memo() or returned false from shouldComponentUpdate.
      const renderedChild = useMemo(() => {
        if (shouldHandleStateChanges) {
          // If this component is subscribed to store updates, we need to pass its own
          // subscription instance down to our descendants. That means rendering the same
          // Context instance, and putting a different value into the context.
          // 如果组件订阅了store的更新，我们需要把它的subscription传递给子级
          // 也就是同样的context使用不同的值
          return (
            <ContextToUse.Provider value={overriddenContextValue}>
              {renderedWrappedComponent}
            </ContextToUse.Provider>
          );
        }

        return renderedWrappedComponent;
      }, [ContextToUse, renderedWrappedComponent, overriddenContextValue]);

      return renderedChild;
    }

    // If we're in "pure" mode, ensure our wrapper component only re-renders when incoming props have changed.
    // pure时用React.memo优化
    const Connect = pure ? React.memo(ConnectFunction) : ConnectFunction;

    Connect.WrappedComponent = WrappedComponent;
    Connect.displayName = displayName;

    // 如果forwardRef开启，则需要把子级的ref传递出来
    if (forwardRef) {
      const forwarded = React.forwardRef(function forwardConnectRef(
        props,
        ref
      ) {
        return <Connect {...props} forwardedRef={ref} />;
      });

      forwarded.displayName = displayName;
      forwarded.WrappedComponent = WrappedComponent;
      // 拷贝静态方法并返回
      return hoistStatics(forwarded, WrappedComponent);
    }

    return hoistStatics(Connect, WrappedComponent);
  };
}
