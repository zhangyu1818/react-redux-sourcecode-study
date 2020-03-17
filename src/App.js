import React from "react";
import { connect, Provider, useDispatch, useSelector } from "./react-redux";
import store from "./store";
import { bindActionCreators } from "redux";

function App() {
  return (
    // 在这种情况下，Test4、Test7、Test1都订阅了store都变化
    // Test5,Test6订阅的Test4
    // Test3订阅的Test2，Test2订阅的Test1
    <Provider store={store}>
      <Test4>
        <Test5 />
        <Test6 />
      </Test4>
      <Test7 />
      <Test1>
        <Test2>
          <Test3 />
        </Test2>
      </Test1>
      {/*<Test1>*/}
      {/*  <Test2>*/}
      {/*    <Test3 />*/}
      {/*  </Test2>*/}
      {/*</Test1>*/}
    </Provider>
  );
}

const Test = React.forwardRef(function ForwardTest(
  { increase, setString, decrease, count, string, children, ...other },
  ref
) {
  return (
    <div className="refEle" ref={ref}>
      {string}
      {setString ? (
        <button onClick={setString}>set string</button>
      ) : (
        <div>
          {count}
          <button onClick={decrease}>-</button>
          <button onClick={increase}>+</button>
        </div>
      )}
      {children && (
        <div>
          children:
          <div style={{ marginLeft: 50 }}>{children}</div>
        </div>
      )}
    </div>
  );
});

const WithConnect = (
  Component,
  name,
  {
    mapStateToProps = ({ count }) => ({ ...count, name }),
    mapDispatchToProps = {
      increase: () => ({
        type: "INCREASE"
      }),
      decrease: () => ({
        type: "DECREASE"
      })
    }
  } = {}
) => {
  Component.name = name;
  return connect(
    mapStateToProps,
    mapDispatchToProps,
    (stateProps, dispatchProps, ownProps) => ({
      ...stateProps,
      ...dispatchProps,
      ...ownProps,
      name
    }),
    {
      // forwardRef: true,
      shouldHandleStateChanges: true
    }
  )(Component);
};

// hooks测试
const createHooksComponent = () => ({ children }) => {
  const count = useSelector(({ count }) => count.count);
  const dispatch = useDispatch();
  const { increase, decrease } = bindActionCreators(
    {
      increase: () => ({
        type: "INCREASE"
      }),
      decrease: () => ({
        type: "DECREASE"
      })
    },
    dispatch
  );

  return (
    <div>
      <div>
        {count}
        <button onClick={decrease}>-</button>
        <button onClick={increase}>+</button>
      </div>

      {children && (
        <div>
          children:
          <div style={{ marginLeft: 50 }}>{children}</div>
        </div>
      )}
    </div>
  );
};

// const Test1 = createHooksComponent();
// const Test2 = createHooksComponent();
// const Test3 = createHooksComponent();

const Test1 = WithConnect(Test, "Test1");
const Test2 = WithConnect(Test, "Test2");
const Test3 = WithConnect(Test, "Test3", {
  mapStateToProps: ({ count, string }) => ({ ...string, ...count })
});
const Test4 = WithConnect(Test, "Test4");
const Test5 = WithConnect(Test, "Test5");
const Test6 = WithConnect(Test, "Test6");
const Test7 = WithConnect(Test, "Test7", {
  mapStateToProps: ({ string }) => string,
  mapDispatchToProps: { setString: () => ({ type: "SET_STRING" }) }
});

export default App;
