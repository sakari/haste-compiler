module Main where
import Haste
import Haste.Prim

newtype Array a = Array JSAny

foreign import ccall _testArray :: IO JSAny
foreign import ccall logString :: JSString -> IO ()
foreign import ccall logDouble :: Double -> IO ()
foreign import ccall _arrayMap :: Ptr (a -> IO b) -> JSAny -> IO JSAny

testArray :: IO (Array Double)
testArray = Array `fmap` _testArray

arrayMap :: (a -> IO b) -> Array a -> IO (Array b)
arrayMap go (Array arr) = Array `fmap` _arrayMap (toPtr go) arr

main = do
  arr <- testArray
  arrayMap logDouble arr
  arr' <- arrayMap (return . (+ 1)) arr
  arr'' <- arrayMap go arr'
  arrayMap logString arr''

go :: Double -> IO JSString
go = return . toJSStr . show
