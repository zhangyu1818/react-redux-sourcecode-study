import verifyPlainObject from "../utils/verifyPlainObject";

export function wrapMapToPropsConstant(getConstant) {
  return function initConstantSelector(dispatch, options) {
    const constant = getConstant(dispatch, options);
    function constantSelector() {
      return constant;
    }
    constantSelector.dependsOnOwnProps = false;
    return constantSelector;
  };
}

// dependsOnOwnProps is used by createMapToPropsProxy to determine whether to pass props as args
// to the mapToProps function being wrapped. It is also used by makePurePropsSelector to determine
// whether mapToProps needs to be invoked when props have changed.
//
// A length of one signals that mapToProps does not depend on props from the parent component.
// A length of zero is assumed to mean mapToProps is getting args via arguments or ...args and
// therefore not reporting its length accurately..
export function getDependsOnOwnProps(mapToProps) {
  return mapToProps.dependsOnOwnProps !== null &&
    mapToProps.dependsOnOwnProps !== undefined
    ? Boolean(mapToProps.dependsOnOwnProps)
    : mapToProps.length !== 1;
}

// Used by whenMapStateToPropsIsFunction and whenMapDispatchToPropsIsFunction,
// 在whenMapStateToPropsIsFunction和whenMapDispatchToPropsIsFunction时会使用
// this function wraps mapToProps in a proxy function which does several things:
// 这个函数把mapToProps包在一个代理函数中
//
//  * Detects whether the mapToProps function being called depends on props, which
//    is used by selectorFactory to decide if it should reinvoke on props changes.
//    检测函数是否依赖props,selectorFactory会根据props的更改来判断是否应该调用
//
//  * On first call, handles mapToProps if returns another function, and treats that
//    new function as the true mapToProps for subsequent calls.
//    第一次调用的时候，如果mapToProps返回了另一个函数，就用这个新函数来处理mapToProps并且
//    后续调用都用这个新函数
//
//  * On first call, verifies the first result is a plain object, in order to warn
//    the developer that their mapToProps function is not returning a valid result.
//    第一次调用的时候验证结果是不是字面量对象并提示
//
export function wrapMapToPropsFunc(mapToProps, methodName) {
  return function initProxySelector(dispatch, { displayName }) {
    const proxy = function mapToPropsProxy(stateOrDispatch, ownProps) {
      return proxy.dependsOnOwnProps
        ? proxy.mapToProps(stateOrDispatch, ownProps)
        : proxy.mapToProps(stateOrDispatch);
    };
    // 根据dependsOnOwnProps的值来判断是否需要在props改变时重新调用
    // 默认为true，因为要使用detectFactoryAndVerify
    proxy.dependsOnOwnProps = true;

    proxy.mapToProps = function detectFactoryAndVerify(
      stateOrDispatch,
      ownProps
    ) {
      // detectFactoryAndVerify方法只会调用一次
      // 第一次调用后就会被我们传入的mapToProps覆盖掉
      proxy.mapToProps = mapToProps;
      // 这里会判断函数是否依赖于props
      // getDependsOnOwnProps()的主要逻辑就是判断函数的参数个数，如果依赖props则参数等于2，返回true
      proxy.dependsOnOwnProps = getDependsOnOwnProps(mapToProps);
      // 这时的值是由我们传入的mapToProps返回的
      let props = proxy(stateOrDispatch, ownProps);
      // 如果props是一个函数的情况在官方文档有讲
      // https://react-redux.js.org/api/connect#factory-functions
      if (typeof props === "function") {
        proxy.mapToProps = props;
        proxy.dependsOnOwnProps = getDependsOnOwnProps(props);
        props = proxy(stateOrDispatch, ownProps);
      }

      if (process.env.NODE_ENV !== "production")
        // 判断返回的结果是否有效
        verifyPlainObject(props, displayName, methodName);

      return props;
    };

    return proxy;
  };
}
